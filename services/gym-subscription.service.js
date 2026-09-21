const pool = require('../db/pool')

async function createGymSubscription(studentId, gymId) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO gym_subscriptions (student_id, gym_id)
       SELECT $1, $2 FROM gyms WHERE id = $2 AND status = 'active'
       RETURNING *`,
      [studentId, gymId]
    )
    if (rows.length === 0) {
      throw Object.assign(
        new Error('Gym not found or not active.'),
        { status: 404, code: 'GYM_NOT_FOUND' }
      )
    }
    return rows[0]
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(
        new Error('You already have an active subscription to this gym.'),
        { status: 409, code: 'ALREADY_SUBSCRIBED' }
      )
    }
    throw err
  }
}

async function getStudentGymSubscription(studentId, gymId) {
  const { rows } = await pool.query(
    `SELECT id, status, subscribed_at
     FROM gym_subscriptions
     WHERE student_id = $1 AND gym_id = $2 AND status = 'active'
     LIMIT 1`,
    [studentId, gymId]
  )
  return rows[0] || null
}

async function listStudentGymSubscriptions(studentId) {
  const { rows } = await pool.query(
    `SELECT gs.id, gs.status, gs.subscribed_at, gs.cancelled_at, gs.gym_id,
            g.name AS gym_name
     FROM gym_subscriptions gs
     JOIN gyms g ON g.id = gs.gym_id
     WHERE gs.student_id = $1
     ORDER BY gs.subscribed_at DESC`,
    [studentId]
  )
  return rows
}

async function cancelGymSubscription(gymSubId, studentId) {
  const { rows } = await pool.query(
    `UPDATE gym_subscriptions
     SET status = 'cancelled', cancelled_at = NOW()
     WHERE id = $1 AND student_id = $2 AND status = 'active'
     RETURNING id`,
    [gymSubId, studentId]
  )
  if (rows.length === 0) {
    throw Object.assign(
      new Error('Active gym subscription not found.'),
      { status: 404, code: 'GYM_SUBSCRIPTION_NOT_FOUND' }
    )
  }
}

module.exports = {
  createGymSubscription,
  getStudentGymSubscription,
  listStudentGymSubscriptions,
  cancelGymSubscription
}
