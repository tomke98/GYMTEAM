const pool = require('../db/pool')
const waitlistService = require('./waitlist.service')

async function createBooking(studentId, { scheduleId, sessionDate }) {
  const sid = parseInt(scheduleId, 10)
  if (isNaN(sid)) {
    throw Object.assign(new Error('Invalid schedule id.'), { status: 400, code: 'INVALID_SCHEDULE_ID' })
  }
  if (!sessionDate) {
    throw Object.assign(new Error('Session date is required.'), { status: 400, code: 'MISSING_DATE' })
  }
  const today = new Date().toISOString().split('T')[0]
  if (sessionDate < today) {
    throw Object.assign(new Error('Session date cannot be in the past.'), { status: 400, code: 'PAST_DATE' })
  }

  const { rows: scheduleRows } = await pool.query(
    `SELECT id, trainer_id, gym_id, start_time, end_time, capacity
     FROM schedules WHERE id = $1 AND is_active = TRUE`,
    [sid]
  )
  if (!scheduleRows[0]) {
    throw Object.assign(new Error('Schedule slot not found.'), { status: 404, code: 'SCHEDULE_NOT_FOUND' })
  }
  const schedule = scheduleRows[0]

  await pool.query(
    `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND expires_at < NOW()`
  )
  const { rows: subRows } = await pool.query(
    `SELECT id FROM subscriptions
     WHERE student_id = $1 AND trainer_id = $2 AND status = 'active'
     LIMIT 1`,
    [studentId, schedule.trainer_id]
  )
  if (!subRows[0]) {
    throw Object.assign(
      new Error('Active subscription required to book this trainer.'),
      { status: 403, code: 'SUBSCRIPTION_REQUIRED' }
    )
  }

  // Lock the schedule row for the duration of the capacity check + insert so
  // concurrent requests for the same slot cannot both read "seats available"
  // and both succeed, exceeding capacity.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: lockedRows } = await client.query(
      `SELECT capacity, trainer_id, gym_id, start_time, end_time
       FROM schedules WHERE id = $1 AND is_active = TRUE FOR UPDATE`,
      [sid]
    )
    if (!lockedRows[0]) {
      throw Object.assign(new Error('Schedule slot not found.'), { status: 404, code: 'SCHEDULE_NOT_FOUND' })
    }
    const locked = lockedRows[0]

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) AS count FROM bookings
       WHERE schedule_id = $1 AND session_date = $2
       AND status NOT IN ('cancelled_by_student', 'cancelled_by_trainer')`,
      [sid, sessionDate]
    )
    const currentCount = parseInt(countRows[0].count, 10)
    if (currentCount >= locked.capacity) {
      throw Object.assign(
        new Error('This slot is at full capacity. A Waitlist is available.'),
        { status: 409, code: 'SLOT_FULL' }
      )
    }

    const { rows: conflictRows } = await client.query(
      `SELECT b.id FROM bookings b
       WHERE b.student_id = $1 AND b.trainer_id = $2 AND b.session_date = $3
       AND b.start_time = $4 AND b.end_time = $5
       AND b.status NOT IN ('cancelled_by_student', 'cancelled_by_trainer')
       LIMIT 1`,
      [studentId, locked.trainer_id, sessionDate, locked.start_time, locked.end_time]
    )
    if (conflictRows[0]) {
      throw Object.assign(
        new Error('You already have a booking with this trainer on this date and time.'),
        { status: 409, code: 'BOOKING_CONFLICT' }
      )
    }

    const { rows } = await client.query(
      `INSERT INTO bookings (schedule_id, student_id, trainer_id, gym_id, session_date, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed')
       RETURNING *`,
      [sid, studentId, locked.trainer_id, locked.gym_id, sessionDate, locked.start_time, locked.end_time]
    )

    await client.query('COMMIT')
    return rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') {
      throw Object.assign(
        new Error('You already have a booking for this slot on this date.'),
        { status: 409, code: 'BOOKING_CONFLICT' }
      )
    }
    throw err
  } finally {
    client.release()
  }
}

async function listStudentBookings(studentId) {
  const { rows } = await pool.query(
    `SELECT b.id, b.session_date, b.start_time, b.end_time, b.status,
            s.day_of_week, s.session_type AS slot_session_type,
            u.first_name AS trainer_first_name, u.last_name AS trainer_last_name,
            b.trainer_id, b.schedule_id, b.created_at
     FROM bookings b
     JOIN schedules s ON s.id = b.schedule_id
     JOIN users u ON u.id = b.trainer_id
     WHERE b.student_id = $1
     ORDER BY b.session_date DESC, b.start_time DESC`,
    [studentId]
  )
  return rows
}

async function cancelBooking(bookingId, userId, role) {
  const bid = parseInt(bookingId, 10)
  if (isNaN(bid)) {
    throw Object.assign(new Error('Invalid booking id.'), { status: 400, code: 'INVALID_ID' })
  }

  if (role === 'trainer') {
    const client = await pool.connect()
    let cancelledBooking
    try {
      await client.query('BEGIN')

      const { rows } = await client.query(
        `UPDATE bookings SET status = 'cancelled_by_trainer', updated_at = NOW()
         WHERE id = $1 AND trainer_id = $2 AND status = 'confirmed'
         RETURNING *`,
        [bid, userId]
      )
      if (!rows[0]) {
        throw Object.assign(
          new Error('Booking not found or already cancelled.'),
          { status: 404, code: 'BOOKING_NOT_FOUND' }
        )
      }

      await client.query(
        `INSERT INTO cancellation_log (trainer_id, booking_id, cancelled_at)
         VALUES ($1, $2, NOW())`,
        [userId, bid]
      )

      await client.query('COMMIT')
      cancelledBooking = rows[0]
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    try {
      await waitlistService.offerSlotToNext(cancelledBooking.schedule_id, cancelledBooking.session_date)
    } catch (_) {}
    return cancelledBooking
  }

  const { rows } = await pool.query(
    `UPDATE bookings SET status = 'cancelled_by_student', updated_at = NOW()
     WHERE id = $1 AND student_id = $2 AND status = 'confirmed'
     RETURNING *`,
    [bid, userId]
  )
  if (!rows[0]) {
    throw Object.assign(
      new Error('Booking not found or already cancelled.'),
      { status: 404, code: 'BOOKING_NOT_FOUND' }
    )
  }

  try {
    await waitlistService.offerSlotToNext(rows[0].schedule_id, rows[0].session_date)
  } catch (_) {}
  return rows[0]
}

async function listTrainerBookings(trainerId) {
  const { rows } = await pool.query(
    `SELECT b.id, b.session_date, b.start_time, b.end_time, b.status,
            s.day_of_week, s.session_type AS slot_session_type,
            u.first_name AS student_first_name, u.last_name AS student_last_name,
            b.student_id, b.schedule_id, b.created_at
     FROM bookings b
     JOIN schedules s ON s.id = b.schedule_id
     JOIN users u ON u.id = b.student_id
     WHERE b.trainer_id = $1
     ORDER BY b.session_date DESC, b.start_time DESC`,
    [trainerId]
  )
  return rows
}

module.exports = { createBooking, listStudentBookings, cancelBooking, listTrainerBookings }
