const pool = require('../db/pool')

const MAX_DECLINES = 2

async function runAutoExpiry() {
  await pool.query(
    `UPDATE subscriptions
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND expires_at < NOW()`
  )
}

async function createSubscription(studentId, trainerId) {
  await runAutoExpiry()

  const trainerCheck = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND role = 'trainer'`,
    [trainerId]
  )
  if (trainerCheck.rows.length === 0) {
    throw Object.assign(
      new Error('Trainer not found.'),
      { status: 404, code: 'TRAINER_NOT_FOUND' }
    )
  }

  const existing = await pool.query(
    `SELECT id FROM subscriptions
     WHERE student_id = $1 AND trainer_id = $2 AND status IN ('active', 'pending')
     LIMIT 1`,
    [studentId, trainerId]
  )
  if (existing.rows.length > 0) {
    throw Object.assign(
      new Error('You already have an active or pending subscription with this trainer.'),
      { status: 409, code: 'ALREADY_SUBSCRIBED' }
    )
  }

  const blocked = await checkReApplicationBlock(studentId, trainerId)
  if (blocked) {
    throw Object.assign(
      new Error('You have been declined twice by this trainer and cannot re-apply.'),
      { status: 409, code: 'RE_APPLICATION_BLOCKED' }
    )
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO subscriptions (student_id, trainer_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')
       RETURNING *`,
      [studentId, trainerId]
    )
    return rows[0]
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(
        new Error('You already have an active or pending subscription with this trainer.'),
        { status: 409, code: 'ALREADY_SUBSCRIBED' }
      )
    }
    throw err
  }
}

async function getStudentTrainerSubscription(studentId, trainerId) {
  await runAutoExpiry()
  const { rows } = await pool.query(
    `SELECT id, status, requested_at, expires_at
     FROM subscriptions
     WHERE student_id = $1 AND trainer_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [studentId, trainerId]
  )
  return rows[0] || null
}

async function listStudentSubscriptions(studentId) {
  await runAutoExpiry()
  const { rows } = await pool.query(
    `SELECT s.id, s.status, s.requested_at, s.expires_at, s.trainer_id,
            u.first_name AS trainer_first_name, u.last_name AS trainer_last_name
     FROM subscriptions s
     JOIN users u ON u.id = s.trainer_id
     WHERE s.student_id = $1
     ORDER BY s.created_at DESC`,
    [studentId]
  )
  return rows
}

async function checkReApplicationBlock(studentId, trainerId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count FROM subscriptions
     WHERE student_id = $1 AND trainer_id = $2 AND status = 'declined'`,
    [studentId, trainerId]
  )
  return parseInt(rows[0].count, 10) >= MAX_DECLINES
}

async function listTrainerPendingRequests(trainerId) {
  await runAutoExpiry()
  const { rows } = await pool.query(
    `SELECT s.id, s.student_id, s.requested_at, s.expires_at,
            u.first_name AS student_first_name, u.last_name AS student_last_name,
            AVG(sr.rating_coachability)::numeric(3,2) AS avg_coachability,
            AVG(sr.rating_consistency)::numeric(3,2)  AS avg_consistency,
            COUNT(sr.id)::int AS review_count
     FROM subscriptions s
     JOIN users u ON u.id = s.student_id
     LEFT JOIN student_reviews sr
       ON sr.student_id = s.student_id AND sr.is_deleted = FALSE
     WHERE s.trainer_id = $1 AND s.status = 'pending'
     GROUP BY s.id, s.student_id, s.requested_at, s.expires_at, u.first_name, u.last_name
     ORDER BY s.requested_at ASC`,
    [trainerId]
  )
  return rows
}

async function acceptSubscription(subscriptionId, trainerId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE subscriptions
       SET status = 'active', responded_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND trainer_id = $2 AND status = 'pending'
       RETURNING trainer_id`,
      [subscriptionId, trainerId]
    )
    if (rows.length === 0) {
      throw Object.assign(
        new Error('Subscription not found or not pending.'),
        { status: 404, code: 'SUBSCRIPTION_NOT_FOUND' }
      )
    }
    await client.query(
      `INSERT INTO trainer_profiles (id, active_student_count, updated_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (id) DO UPDATE
       SET active_student_count = trainer_profiles.active_student_count + 1, updated_at = NOW()`,
      [trainerId]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function declineSubscription(subscriptionId, trainerId) {
  const { rows } = await pool.query(
    `UPDATE subscriptions
     SET status = 'declined', responded_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND trainer_id = $2 AND status = 'pending'
     RETURNING id`,
    [subscriptionId, trainerId]
  )
  if (rows.length === 0) {
    throw Object.assign(
      new Error('Subscription not found or not pending.'),
      { status: 404, code: 'SUBSCRIPTION_NOT_FOUND' }
    )
  }
}

async function cancelSubscription(subscriptionId, studentId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE subscriptions
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND student_id = $2 AND status = 'active'
       RETURNING trainer_id`,
      [subscriptionId, studentId]
    )
    if (rows.length === 0) {
      throw Object.assign(
        new Error('Active subscription not found.'),
        { status: 404, code: 'SUBSCRIPTION_NOT_FOUND' }
      )
    }
    const { trainer_id } = rows[0]
    await client.query(
      `UPDATE trainer_profiles
       SET active_student_count = GREATEST(0, active_student_count - 1), updated_at = NOW()
       WHERE id = $1`,
      [trainer_id]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function listTrainerActiveStudents(trainerId) {
  const { rows } = await pool.query(
    `SELECT s.id AS subscription_id, s.student_id, s.status, s.created_at,
            u.first_name AS student_first_name, u.last_name AS student_last_name,
            sr.id AS existing_review_id
     FROM subscriptions s
     JOIN users u ON u.id = s.student_id
     LEFT JOIN student_reviews sr ON sr.reviewer_id = s.trainer_id AND sr.student_id = s.student_id AND sr.is_deleted = FALSE
     WHERE s.trainer_id = $1 AND s.status IN ('active', 'cancelled', 'expired')
     ORDER BY s.created_at DESC`,
    [trainerId]
  )
  return rows
}

module.exports = {
  createSubscription,
  getStudentTrainerSubscription,
  listStudentSubscriptions,
  checkReApplicationBlock,
  runAutoExpiry,
  listTrainerPendingRequests,
  acceptSubscription,
  declineSubscription,
  cancelSubscription,
  listTrainerActiveStudents,
}
