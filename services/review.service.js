const pool = require('../db/pool')

async function _getLatestQualifyingSubscription(studentId, trainerId) {
  const { rows } = await pool.query(
    `SELECT id FROM subscriptions
     WHERE student_id = $1 AND trainer_id = $2
     AND status IN ('active', 'cancelled', 'expired')
     ORDER BY created_at DESC LIMIT 1`,
    [studentId, trainerId]
  )
  return rows[0] || null
}

// gym_subscription_status ENUM is only ('active', 'cancelled') — no 'expired'
async function _getLatestQualifyingGymSubscription(studentId, gymId) {
  const { rows } = await pool.query(
    `SELECT id FROM gym_subscriptions
     WHERE student_id = $1 AND gym_id = $2
     AND status IN ('active', 'cancelled')
     ORDER BY subscribed_at DESC LIMIT 1`,
    [studentId, gymId]
  )
  return rows[0] || null
}

const TRAINER_REVIEW_CONFIG = {
  reviewTable: 'trainer_reviews',
  entityColumn: 'trainer_id',
  subscriptionColumn: 'subscription_id',
  profileTable: 'trainer_profiles',
  getQualifyingSub: _getLatestQualifyingSubscription,
  errorMessages: {
    noSub: 'You must have an active or past subscription with this trainer to write a review.',
    alreadyReviewed: "You've already reviewed this trainer.",
  },
}

const GYM_REVIEW_CONFIG = {
  reviewTable: 'gym_reviews',
  entityColumn: 'gym_id',
  subscriptionColumn: 'gym_subscription_id',
  profileTable: 'gyms',
  getQualifyingSub: _getLatestQualifyingGymSubscription,
  errorMessages: {
    noSub: 'You must have an active or past gym subscription to write a review.',
    alreadyReviewed: "You've already reviewed this gym.",
  },
}

async function _recalculateRating({ reviewTable, entityColumn, profileTable }, entityId, client) {
  await client.query(
    `UPDATE ${profileTable} t
     SET
       average_rating        = agg.avg_r,
       recent_average_rating = agg.recent_avg_r,
       review_count          = agg.cnt,
       updated_at            = NOW()
     FROM (
       SELECT
         AVG(rating)::numeric(3,2) AS avg_r,
         COUNT(*)::int             AS cnt,
         AVG(rating) FILTER (WHERE created_at >= NOW() - INTERVAL '6 months')::numeric(3,2) AS recent_avg_r
       FROM ${reviewTable}
       WHERE ${entityColumn} = $1 AND is_deleted = FALSE
     ) agg
     WHERE t.id = $1`,
    [entityId]
  )
}

async function _createReview(config, studentId, entityId, r, comment) {
  const { reviewTable, entityColumn, subscriptionColumn, getQualifyingSub, errorMessages } = config

  const sub = await getQualifyingSub(studentId, entityId)
  if (!sub) {
    throw Object.assign(new Error(errorMessages.noSub), { status: 403, code: 'SUBSCRIPTION_REQUIRED' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: existing } = await client.query(
      `SELECT id FROM ${reviewTable}
       WHERE reviewer_id = $1 AND ${entityColumn} = $2 AND is_deleted = FALSE`,
      [studentId, entityId]
    )
    if (existing[0]) {
      throw Object.assign(new Error(errorMessages.alreadyReviewed), { status: 409, code: 'ALREADY_REVIEWED' })
    }

    let newReview
    try {
      const { rows } = await client.query(
        `INSERT INTO ${reviewTable} (${subscriptionColumn}, reviewer_id, ${entityColumn}, rating, comment)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [sub.id, studentId, entityId, r, comment]
      )
      newReview = rows[0]
    } catch (err) {
      if (err.code === '23505') {
        throw Object.assign(new Error(errorMessages.alreadyReviewed), { status: 409, code: 'ALREADY_REVIEWED' })
      }
      // FK violation: subscription was cascade-deleted between eligibility check and INSERT
      if (err.code === '23503') {
        throw Object.assign(new Error(errorMessages.noSub), { status: 403, code: 'SUBSCRIPTION_REQUIRED' })
      }
      throw err
    }

    await _recalculateRating(config, entityId, client)

    await client.query('COMMIT')
    return newReview
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

// preloadedSub: pass an already-fetched subscription object to skip the re-query.
// Pass undefined (or omit) to let the function fetch it itself.
// Pass null explicitly only if you know there is no qualifying subscription.
async function _getStudentReviewContext(config, studentId, entityId, preloadedSub) {
  const sub = preloadedSub !== undefined
    ? preloadedSub
    : await config.getQualifyingSub(studentId, entityId)
  if (!sub) return { qualifyingSubscription: null, existingReview: null }

  const { rows: reviewRows } = await pool.query(
    `SELECT id, rating, comment, created_at, edited_at, locked_at
     FROM ${config.reviewTable}
     WHERE reviewer_id = $1 AND ${config.entityColumn} = $2 AND is_deleted = FALSE`,
    [studentId, entityId]
  )
  return { qualifyingSubscription: sub, existingReview: reviewRows[0] || null }
}

async function createTrainerReview(studentId, { trainerId, rating, comment }) {
  const tid = parseInt(trainerId, 10)
  if (isNaN(tid)) {
    throw Object.assign(new Error('Invalid trainer id.'), { status: 400, code: 'INVALID_TRAINER_ID' })
  }
  const r = parseInt(rating, 10)
  if (isNaN(r) || r < 1 || r > 5) {
    throw Object.assign(new Error('Rating must be between 1 and 5.'), { status: 400, code: 'INVALID_RATING' })
  }
  if (!comment || !comment.trim()) {
    throw Object.assign(new Error('Comment is required.'), { status: 400, code: 'MISSING_COMMENT' })
  }
  return _createReview(TRAINER_REVIEW_CONFIG, studentId, tid, r, comment.trim())
}

async function createGymReview(studentId, { gymId, rating, comment }) {
  const gid = parseInt(gymId, 10)
  if (isNaN(gid)) {
    throw Object.assign(new Error('Invalid gym id.'), { status: 400, code: 'INVALID_GYM_ID' })
  }
  const r = parseInt(rating, 10)
  if (isNaN(r) || r < 1 || r > 5) {
    throw Object.assign(new Error('Rating must be between 1 and 5.'), { status: 400, code: 'INVALID_RATING' })
  }
  if (!comment || !comment.trim()) {
    throw Object.assign(new Error('Comment is required.'), { status: 400, code: 'MISSING_COMMENT' })
  }
  return _createReview(GYM_REVIEW_CONFIG, studentId, gid, r, comment.trim())
}

// preloadedSub: an already-fetched subscription object (active qualifies), or undefined to
// trigger a fresh DB lookup (needed when the caller only has non-qualifying-status subs).
async function getStudentTrainerReviewContext(studentId, trainerId, preloadedSub) {
  return _getStudentReviewContext(TRAINER_REVIEW_CONFIG, studentId, trainerId, preloadedSub)
}

async function getStudentGymReviewContext(studentId, gymId, preloadedSub) {
  return _getStudentReviewContext(GYM_REVIEW_CONFIG, studentId, gymId, preloadedSub)
}

async function createStudentReview(trainerId, { subscriptionId, ratingCoachability, ratingConsistency, comment }) {
  const sid = parseInt(subscriptionId, 10)
  if (isNaN(sid)) {
    throw Object.assign(new Error('Invalid subscription id.'), { status: 400, code: 'INVALID_SUBSCRIPTION_ID' })
  }
  const rc = parseInt(ratingCoachability, 10)
  if (isNaN(rc) || rc < 1 || rc > 5) {
    throw Object.assign(new Error('Coachability rating must be between 1 and 5.'), { status: 400, code: 'INVALID_RATING' })
  }
  const rs = parseInt(ratingConsistency, 10)
  if (isNaN(rs) || rs < 1 || rs > 5) {
    throw Object.assign(new Error('Consistency rating must be between 1 and 5.'), { status: 400, code: 'INVALID_RATING' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: subRows } = await client.query(
      `SELECT id, student_id FROM subscriptions
       WHERE id = $1 AND trainer_id = $2 AND status IN ('active', 'cancelled', 'expired')
       FOR UPDATE`,
      [sid, trainerId]
    )
    if (!subRows[0]) {
      throw Object.assign(
        new Error('No qualifying subscription found.'),
        { status: 403, code: 'SUBSCRIPTION_REQUIRED' }
      )
    }
    const sub = subRows[0]

    let newReview
    try {
      const { rows } = await client.query(
        `INSERT INTO student_reviews
           (subscription_id, reviewer_id, student_id, rating_coachability, rating_consistency, comment)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [sid, trainerId, sub.student_id, rc, rs, comment && comment.trim() ? comment.trim() : null]
      )
      newReview = rows[0]
    } catch (err) {
      if (err.code === '23505') {
        throw Object.assign(
          new Error("You've already reviewed this student."),
          { status: 409, code: 'ALREADY_REVIEWED' }
        )
      }
      if (err.code === '23503') {
        throw Object.assign(
          new Error('No qualifying subscription found.'),
          { status: 403, code: 'SUBSCRIPTION_REQUIRED' }
        )
      }
      throw err
    }

    await client.query('COMMIT')
    return newReview
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

async function getStudentReviews(trainerId, studentId) {
  const { rows } = await pool.query(
    `WITH gate AS (
       SELECT EXISTS(
         SELECT 1 FROM subscriptions
         WHERE trainer_id = $1 AND student_id = $2 AND status IN ('active', 'cancelled', 'expired')
       ) AS allowed
     )
     SELECT gate.allowed,
            sr.id, sr.rating_coachability, sr.rating_consistency, sr.comment, sr.created_at,
            u.first_name AS reviewer_first_name, u.last_name AS reviewer_last_name
     FROM gate
     LEFT JOIN student_reviews sr
       ON sr.reviewer_id = $1 AND sr.student_id = $2 AND sr.is_deleted = FALSE
     LEFT JOIN users u ON u.id = sr.reviewer_id
     ORDER BY sr.created_at DESC`,
    [trainerId, studentId]
  )

  if (!rows[0] || !rows[0].allowed) {
    throw Object.assign(new Error('Access denied.'), { status: 403, code: 'ACCESS_DENIED' })
  }

  return rows
    .filter(r => r.id !== null)
    .map(({ allowed, ...rest }) => rest)
}

async function _editReview(config, studentId, reviewId, r, comment) {
  const rid = parseInt(reviewId, 10)
  if (isNaN(rid)) {
    throw Object.assign(new Error('Invalid review id.'), { status: 400, code: 'INVALID_REVIEW_ID' })
  }
  const { reviewTable, entityColumn } = config

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: reviewRows } = await client.query(
      `SELECT id, ${entityColumn}, created_at, locked_at
       FROM ${reviewTable}
       WHERE id = $1 AND reviewer_id = $2 AND is_deleted = FALSE
       FOR UPDATE`,
      [rid, studentId]
    )
    if (!reviewRows[0]) {
      throw Object.assign(new Error('Review not found.'), { status: 404, code: 'REVIEW_NOT_FOUND' })
    }
    const review = reviewRows[0]

    if (review.locked_at) {
      throw Object.assign(
        new Error('This review has already been edited and is now locked.'),
        { status: 409, code: 'REVIEW_LOCKED' }
      )
    }

    const ageMs = Date.now() - new Date(review.created_at).getTime()
    if (ageMs > 48 * 60 * 60 * 1000) {
      throw Object.assign(
        new Error('The 48-hour edit window for this review has closed.'),
        { status: 409, code: 'EDIT_WINDOW_CLOSED' }
      )
    }

    await client.query(
      `UPDATE ${reviewTable}
       SET rating = $1, comment = $2, edited_at = NOW(), locked_at = NOW()
       WHERE id = $3`,
      [r, comment, rid]
    )

    await _recalculateRating(config, review[entityColumn], client)

    await client.query('COMMIT')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

async function softDeleteReview(adminId, { reviewType, reviewId }) {
  const rid = parseInt(reviewId, 10)
  if (isNaN(rid)) {
    throw Object.assign(new Error('Invalid review id.'), { status: 400, code: 'INVALID_REVIEW_ID' })
  }
  if (reviewType !== 'trainer' && reviewType !== 'gym' && reviewType !== 'student') {
    throw Object.assign(new Error('Invalid review type.'), { status: 400, code: 'INVALID_REVIEW_TYPE' })
  }

  if (reviewType === 'student') {
    const { rows } = await pool.query(
      `UPDATE student_reviews SET is_deleted = TRUE, deleted_by = $2, deleted_at = NOW()
       WHERE id = $1 AND is_deleted = FALSE
       RETURNING id`,
      [rid, adminId]
    )
    if (!rows[0]) {
      throw Object.assign(new Error('Review not found or already deleted.'), { status: 404, code: 'REVIEW_NOT_FOUND' })
    }
    return
  }

  const config = reviewType === 'trainer' ? TRAINER_REVIEW_CONFIG : GYM_REVIEW_CONFIG

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE ${config.reviewTable}
       SET is_deleted = TRUE, deleted_by = $1, deleted_at = NOW()
       WHERE id = $2 AND is_deleted = FALSE
       RETURNING ${config.entityColumn}`,
      [adminId, rid]
    )
    if (!rows[0]) {
      throw Object.assign(new Error('Review not found or already deleted.'), { status: 404, code: 'REVIEW_NOT_FOUND' })
    }
    await _recalculateRating(config, rows[0][config.entityColumn], client)
    await client.query('COMMIT')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

async function restoreReview(adminId, { reviewType, reviewId }) {
  const rid = parseInt(reviewId, 10)
  if (isNaN(rid)) {
    throw Object.assign(new Error('Invalid review id.'), { status: 400, code: 'INVALID_REVIEW_ID' })
  }
  if (reviewType !== 'trainer' && reviewType !== 'gym' && reviewType !== 'student') {
    throw Object.assign(new Error('Invalid review type.'), { status: 400, code: 'INVALID_REVIEW_TYPE' })
  }

  if (reviewType === 'student') {
    const { rows } = await pool.query(
      `UPDATE student_reviews SET is_deleted = FALSE
       WHERE id = $1 AND is_deleted = TRUE
       RETURNING id`,
      [rid]
    )
    if (!rows[0]) {
      throw Object.assign(new Error('Review not found or not deleted.'), { status: 404, code: 'REVIEW_NOT_FOUND' })
    }
    return
  }

  const config = reviewType === 'trainer' ? TRAINER_REVIEW_CONFIG : GYM_REVIEW_CONFIG

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE ${config.reviewTable}
       SET is_deleted = FALSE
       WHERE id = $1 AND is_deleted = TRUE
       RETURNING ${config.entityColumn}`,
      [rid]
    )
    if (!rows[0]) {
      throw Object.assign(new Error('Review not found or not deleted.'), { status: 404, code: 'REVIEW_NOT_FOUND' })
    }
    await _recalculateRating(config, rows[0][config.entityColumn], client)
    await client.query('COMMIT')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

async function editTrainerReview(studentId, { reviewId, rating, comment }) {
  const r = parseInt(rating, 10)
  if (isNaN(r) || r < 1 || r > 5) {
    throw Object.assign(new Error('Rating must be between 1 and 5.'), { status: 400, code: 'INVALID_RATING' })
  }
  if (!comment || !comment.trim()) {
    throw Object.assign(new Error('Comment is required.'), { status: 400, code: 'MISSING_COMMENT' })
  }
  return _editReview(TRAINER_REVIEW_CONFIG, studentId, reviewId, r, comment.trim())
}

async function editGymReview(studentId, { reviewId, rating, comment }) {
  const r = parseInt(rating, 10)
  if (isNaN(r) || r < 1 || r > 5) {
    throw Object.assign(new Error('Rating must be between 1 and 5.'), { status: 400, code: 'INVALID_RATING' })
  }
  if (!comment || !comment.trim()) {
    throw Object.assign(new Error('Comment is required.'), { status: 400, code: 'MISSING_COMMENT' })
  }
  return _editReview(GYM_REVIEW_CONFIG, studentId, reviewId, r, comment.trim())
}

module.exports = {
  createTrainerReview,
  createGymReview,
  getStudentTrainerReviewContext,
  getStudentGymReviewContext,
  createStudentReview,
  getStudentReviews,
  editTrainerReview,
  editGymReview,
  softDeleteReview,
  restoreReview,
}
