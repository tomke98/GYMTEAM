const pool = require('../db/pool')

const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const VALID_SESSION_TYPES = ['individual', 'group', 'semi_private']

function validateSlotInputs({ dayOfWeek, startTime, endTime, sessionType, capacity }) {
  if (!dayOfWeek || !VALID_DAYS.includes(dayOfWeek)) {
    throw Object.assign(new Error('Invalid day of week.'), { status: 400, code: 'INVALID_DAY' })
  }
  if (!startTime || !endTime) {
    throw Object.assign(new Error('Start time and end time are required.'), { status: 400, code: 'MISSING_TIME' })
  }
  const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    throw Object.assign(new Error('Times must be in HH:MM format.'), { status: 400, code: 'INVALID_TIME_FORMAT' })
  }
  if (startTime >= endTime) {
    throw Object.assign(new Error('End time must be after start time.'), { status: 400, code: 'INVALID_TIME_RANGE' })
  }
  if (!sessionType || !VALID_SESSION_TYPES.includes(sessionType)) {
    throw Object.assign(new Error('Invalid session type.'), { status: 400, code: 'INVALID_SESSION_TYPE' })
  }
  const cap = parseInt(capacity, 10)
  if (isNaN(cap) || cap < 1) {
    throw Object.assign(new Error('Capacity must be a positive integer.'), { status: 400, code: 'INVALID_CAPACITY' })
  }
  return cap
}

async function createSchedule(trainerId, { dayOfWeek, startTime, endTime, sessionType, capacity, perSessionRate, gymId = null }) {
  const cap = validateSlotInputs({ dayOfWeek, startTime, endTime, sessionType, capacity })
  const rate = (perSessionRate !== '' && perSessionRate != null) ? parseFloat(perSessionRate) : null
  if (rate !== null && (isNaN(rate) || rate < 0)) {
    throw Object.assign(new Error('Invalid per-session rate.'), { status: 400, code: 'INVALID_RATE' })
  }
  const { rows } = await pool.query(
    `INSERT INTO schedules (trainer_id, gym_id, day_of_week, start_time, end_time, session_type, capacity, per_session_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [trainerId, gymId, dayOfWeek, startTime, endTime, sessionType, cap, rate]
  )
  return rows[0]
}

async function listTrainerSchedules(trainerId) {
  const { rows } = await pool.query(
    `SELECT * FROM schedules
     WHERE trainer_id = $1 AND is_active = TRUE
     ORDER BY day_of_week, start_time, id ASC`,
    [trainerId]
  )
  return rows
}

async function getSchedule(scheduleId, trainerId) {
  const { rows } = await pool.query(
    `SELECT * FROM schedules
     WHERE id = $1 AND trainer_id = $2 AND is_active = TRUE`,
    [scheduleId, trainerId]
  )
  if (!rows[0]) {
    throw Object.assign(new Error('Schedule slot not found.'), { status: 404, code: 'SCHEDULE_NOT_FOUND' })
  }
  return rows[0]
}

async function updateSchedule(scheduleId, trainerId, { dayOfWeek, startTime, endTime, sessionType, capacity, perSessionRate, gymId = null }) {
  const cap = validateSlotInputs({ dayOfWeek, startTime, endTime, sessionType, capacity })
  const rate = (perSessionRate !== '' && perSessionRate != null) ? parseFloat(perSessionRate) : null
  if (rate !== null && (isNaN(rate) || rate < 0)) {
    throw Object.assign(new Error('Invalid per-session rate.'), { status: 400, code: 'INVALID_RATE' })
  }
  const { rows } = await pool.query(
    `UPDATE schedules
     SET gym_id = $1, day_of_week = $2, start_time = $3, end_time = $4,
         session_type = $5, capacity = $6, per_session_rate = $7
     WHERE id = $8 AND trainer_id = $9 AND is_active = TRUE
     RETURNING *`,
    [gymId, dayOfWeek, startTime, endTime, sessionType, cap, rate, scheduleId, trainerId]
  )
  if (!rows[0]) {
    throw Object.assign(new Error('Schedule slot not found.'), { status: 404, code: 'SCHEDULE_NOT_FOUND' })
  }
  return rows[0]
}

async function deleteSchedule(scheduleId, trainerId) {
  const { rows } = await pool.query(
    `UPDATE schedules SET is_active = FALSE
     WHERE id = $1 AND trainer_id = $2 AND is_active = TRUE
     RETURNING id`,
    [scheduleId, trainerId]
  )
  if (!rows[0]) {
    throw Object.assign(new Error('Schedule slot not found.'), { status: 404, code: 'SCHEDULE_NOT_FOUND' })
  }
}

module.exports = { createSchedule, listTrainerSchedules, getSchedule, updateSchedule, deleteSchedule }
