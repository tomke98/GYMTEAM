const bcrypt = require('bcryptjs')
const pool = require('../db/pool')

const PAGE_SIZE = 50
const CANCELLATION_ALERT_THRESHOLD = 3
const CANCELLATION_ALERT_WINDOW_DAYS = 30

function extractPage(rows) {
  const total = rows[0]?.total_count ?? 0
  const items = rows.map(({ total_count, ...rest }) => rest)
  return { items, total }
}

// ─── Reviews ────────────────────────────────────────────────────────────────

async function adminListReviews({ page = 1 } = {}) {
  const offset = (page - 1) * PAGE_SIZE
  const { rows } = await pool.query(`
    SELECT *, COUNT(*) OVER()::int AS total_count
    FROM (
      SELECT tr.id, 'trainer' AS review_type,
             tr.trainer_id AS entity_id,
             COALESCE(u_entity.first_name || ' ' || u_entity.last_name, '[deleted user]') AS entity_name,
             COALESCE(u_rev.first_name || ' ' || u_rev.last_name, '[deleted user]') AS reviewer_name,
             tr.rating, NULL::smallint AS rating_coachability, NULL::smallint AS rating_consistency,
             tr.comment, tr.created_at, tr.edited_at,
             tr.is_deleted, tr.deleted_at
      FROM trainer_reviews tr
      LEFT JOIN users u_entity ON u_entity.id = tr.trainer_id
      LEFT JOIN users u_rev    ON u_rev.id    = tr.reviewer_id
      UNION ALL
      SELECT gr.id, 'gym' AS review_type,
             gr.gym_id AS entity_id,
             COALESCE(g.name, '[deleted gym]') AS entity_name,
             COALESCE(u_rev.first_name || ' ' || u_rev.last_name, '[deleted user]') AS reviewer_name,
             gr.rating, NULL::smallint AS rating_coachability, NULL::smallint AS rating_consistency,
             gr.comment, gr.created_at, gr.edited_at,
             gr.is_deleted, gr.deleted_at
      FROM gym_reviews gr
      LEFT JOIN gyms g      ON g.id     = gr.gym_id
      LEFT JOIN users u_rev ON u_rev.id = gr.reviewer_id
      UNION ALL
      SELECT sr.id, 'student' AS review_type,
             sr.student_id AS entity_id,
             COALESCE(u_student.first_name || ' ' || u_student.last_name, '[deleted user]') AS entity_name,
             COALESCE(u_rev.first_name || ' ' || u_rev.last_name, '[deleted user]') AS reviewer_name,
             NULL::smallint AS rating, sr.rating_coachability, sr.rating_consistency,
             sr.comment, sr.created_at, NULL::timestamp AS edited_at,
             FALSE AS is_deleted, NULL::timestamp AS deleted_at
      FROM student_reviews sr
      LEFT JOIN users u_student ON u_student.id = sr.student_id
      LEFT JOIN users u_rev     ON u_rev.id     = sr.reviewer_id
    ) sub
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `, [PAGE_SIZE, offset])

  const { items: reviews, total } = extractPage(rows)
  return { reviews, total, page, pageSize: PAGE_SIZE }
}

// ─── Users ───────────────────────────────────────────────────────────────────

async function adminListUsers({ page = 1 } = {}) {
  const offset = (page - 1) * PAGE_SIZE
  const { rows } = await pool.query(`
    SELECT id, first_name, last_name, email, role, is_active, created_at,
           COUNT(*) OVER()::int AS total_count
    FROM users
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `, [PAGE_SIZE, offset])
  const { items: users, total } = extractPage(rows)
  return { users, total, page, pageSize: PAGE_SIZE }
}

async function adminCreateUser({ firstName, lastName, email, password, role }) {
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password?.trim() || !role) {
    throw Object.assign(new Error('All fields are required.'), { status: 400, code: 'MISSING_FIELD' })
  }
  if (!['student', 'trainer'].includes(role)) {
    throw Object.assign(new Error('Invalid role.'), { status: 400, code: 'INVALID_ROLE' })
  }
  const normalizedEmail = email.toLowerCase().trim()
  const passwordHash = await bcrypt.hash(password.trim(), 12)
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, email, role, is_active, created_at`,
      [firstName.trim(), lastName.trim(), normalizedEmail, passwordHash, role]
    )
    return rows[0]
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(new Error('An account with this email already exists.'), { status: 409, code: 'EMAIL_TAKEN' })
    }
    throw err
  }
}

async function adminUpdateUser(targetId, { firstName, lastName, email }) {
  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    throw Object.assign(new Error('First name, last name, and email are required.'), { status: 400, code: 'MISSING_FIELD' })
  }
  const existing = await pool.query('SELECT id FROM users WHERE id = $1', [targetId])
  if (!existing.rows[0]) {
    throw Object.assign(new Error('User not found.'), { status: 404, code: 'USER_NOT_FOUND' })
  }
  const normalizedEmail = email.toLowerCase().trim()
  try {
    await pool.query(
      'UPDATE users SET first_name=$1, last_name=$2, email=$3, updated_at=NOW() WHERE id=$4',
      [firstName.trim(), lastName.trim(), normalizedEmail, targetId]
    )
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(new Error('Email already in use.'), { status: 409, code: 'EMAIL_TAKEN' })
    }
    throw err
  }
}

async function adminSetUserActive(targetId, isActive) {
  const { rows } = await pool.query(
    'UPDATE users SET is_active=$1, updated_at=NOW() WHERE id=$2 RETURNING id',
    [isActive, targetId]
  )
  if (!rows[0]) {
    throw Object.assign(new Error('User not found.'), { status: 404, code: 'USER_NOT_FOUND' })
  }
}

async function adminDeleteUser(targetId) {
  const { rows } = await pool.query('DELETE FROM users WHERE id=$1 RETURNING id', [targetId])
  if (!rows[0]) {
    throw Object.assign(new Error('User not found.'), { status: 404, code: 'USER_NOT_FOUND' })
  }
}

async function adminDeleteTrainerProfile(trainerId) {
  const { rows } = await pool.query('DELETE FROM trainer_profiles WHERE id=$1 RETURNING id', [trainerId])
  if (!rows[0]) {
    throw Object.assign(new Error('Trainer profile not found.'), { status: 404, code: 'TRAINER_PROFILE_NOT_FOUND' })
  }
}

// ─── Gyms ────────────────────────────────────────────────────────────────────

async function adminListGyms({ page = 1 } = {}) {
  const offset = (page - 1) * PAGE_SIZE
  const { rows } = await pool.query(`
    SELECT g.id, g.name, g.status, g.monthly_price, g.created_at,
           g.trainer_id,
           COALESCE(u.first_name || ' ' || u.last_name, '[deleted user]') AS trainer_name,
           COUNT(*) OVER()::int AS total_count
    FROM gyms g
    LEFT JOIN users u ON u.id = g.trainer_id
    ORDER BY g.created_at DESC
    LIMIT $1 OFFSET $2
  `, [PAGE_SIZE, offset])
  const { items: gyms, total } = extractPage(rows)
  return { gyms, total, page, pageSize: PAGE_SIZE }
}

async function adminDeleteGym(gymId) {
  const { rows } = await pool.query('DELETE FROM gyms WHERE id=$1 RETURNING id', [gymId])
  if (!rows[0]) {
    throw Object.assign(new Error('Gym not found.'), { status: 404, code: 'GYM_NOT_FOUND' })
  }
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

async function adminGetStats() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users)            AS user_count,
      (SELECT COUNT(*)::int FROM trainer_profiles) AS trainer_count,
      (SELECT COUNT(*)::int FROM gyms)             AS gym_count,
      (SELECT COUNT(*)::int FROM trainer_reviews WHERE is_deleted = FALSE)
        + (SELECT COUNT(*)::int FROM gym_reviews WHERE is_deleted = FALSE)
        + (SELECT COUNT(*)::int FROM student_reviews WHERE is_deleted = FALSE)  AS review_count
  `)
  return rows[0] ?? {}
}

async function adminGetCancellationAlerts() {
  const { rows } = await pool.query(`
    SELECT
      u.id            AS trainer_id,
      u.first_name,
      u.last_name,
      u.email,
      COUNT(cl.id)::int AS cancellation_count
    FROM cancellation_log cl
    JOIN users u ON u.id = cl.trainer_id
    WHERE u.role = 'trainer'
      AND cl.cancelled_at >= NOW() - ($1 * INTERVAL '1 day')
    GROUP BY u.id
    HAVING COUNT(cl.id) >= $2
    ORDER BY cancellation_count DESC, u.last_name
  `, [CANCELLATION_ALERT_WINDOW_DAYS, CANCELLATION_ALERT_THRESHOLD])
  return rows
}

module.exports = {
  adminListReviews,
  adminListUsers, adminCreateUser, adminUpdateUser, adminSetUserActive,
  adminDeleteUser, adminDeleteTrainerProfile,
  adminListGyms, adminDeleteGym,
  adminGetStats, adminGetCancellationAlerts,
  CANCELLATION_ALERT_THRESHOLD, CANCELLATION_ALERT_WINDOW_DAYS
}
