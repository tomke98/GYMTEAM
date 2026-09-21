const pool = require('../db/pool')

async function processClaimExpiry() {
  const { rows } = await pool.query(
    `UPDATE waitlist SET status = 'expired'
     WHERE status = 'offered' AND claim_expires_at < NOW()
     RETURNING schedule_id, session_date`
  )
  const seen = new Set()
  for (const row of rows) {
    const key = `${row.schedule_id}:${row.session_date}`
    if (!seen.has(key)) {
      seen.add(key)
      await offerSlotToNext(row.schedule_id, row.session_date)
    }
  }
}

async function offerSlotToNext(scheduleId, sessionDate) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Lock the schedule row so concurrent calls for the same slot serialize here.
    const { rows: capRows } = await client.query(
      `SELECT capacity FROM schedules WHERE id = $1 AND is_active = TRUE FOR UPDATE`,
      [scheduleId]
    )
    if (!capRows[0]) {
      await client.query('ROLLBACK')
      return null
    }

    // Count confirmed bookings + outstanding 'offered' waitlist entries together.
    // Treating offered entries as occupied prevents a second concurrent call (after
    // the lock releases) from also offering a slot before the first offer is claimed.
    const { rows: countRows } = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM bookings
          WHERE schedule_id = $1 AND session_date = $2
          AND status NOT IN ('cancelled_by_student', 'cancelled_by_trainer'))
         +
         (SELECT COUNT(*) FROM waitlist
          WHERE schedule_id = $1 AND session_date = $2 AND status = 'offered')
       AS occupied`,
      [scheduleId, sessionDate]
    )
    if (parseInt(countRows[0].occupied, 10) >= capRows[0].capacity) {
      await client.query('ROLLBACK')
      return null
    }

    const { rows } = await client.query(
      `UPDATE waitlist
       SET status = 'offered', claim_offered_at = NOW(), claim_expires_at = NOW() + INTERVAL '24 hours'
       WHERE id = (
         SELECT id FROM waitlist
         WHERE schedule_id = $1 AND session_date = $2 AND status = 'waiting'
         ORDER BY position ASC, created_at ASC
         LIMIT 1
       )
       RETURNING *`,
      [scheduleId, sessionDate]
    )

    await client.query('COMMIT')
    return rows[0] || null
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function joinWaitlist(studentId, { scheduleId, sessionDate }) {
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

  await processClaimExpiry()

  const { rows: schedRows } = await pool.query(
    `SELECT id, trainer_id, capacity FROM schedules WHERE id = $1 AND is_active = TRUE`,
    [sid]
  )
  if (!schedRows[0]) {
    throw Object.assign(new Error('Schedule slot not found.'), { status: 404, code: 'SCHEDULE_NOT_FOUND' })
  }

  await pool.query(
    `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending' AND expires_at < NOW()`
  )
  const { rows: subRows } = await pool.query(
    `SELECT id FROM subscriptions
     WHERE student_id = $1 AND trainer_id = $2 AND status = 'active'
     LIMIT 1`,
    [studentId, schedRows[0].trainer_id]
  )
  if (!subRows[0]) {
    throw Object.assign(
      new Error('Active subscription required to join the waitlist.'),
      { status: 403, code: 'SUBSCRIPTION_REQUIRED' }
    )
  }

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE schedule_id = $1 AND session_date = $2
     AND status NOT IN ('cancelled_by_student', 'cancelled_by_trainer')`,
    [sid, sessionDate]
  )
  if (parseInt(countRows[0].count, 10) < schedRows[0].capacity) {
    throw Object.assign(
      new Error('This slot still has available capacity — book directly instead of joining the waitlist.'),
      { status: 409, code: 'SLOT_AVAILABLE' }
    )
  }

  const { rows: posRows } = await pool.query(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
     FROM waitlist WHERE schedule_id = $1 AND session_date = $2 AND status IN ('waiting', 'offered')`,
    [sid, sessionDate]
  )

  try {
    const { rows } = await pool.query(
      `INSERT INTO waitlist (schedule_id, session_date, student_id, position, status)
       VALUES ($1, $2, $3, $4, 'waiting')
       RETURNING *`,
      [sid, sessionDate, studentId, posRows[0].next_pos]
    )
    return rows[0]
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(
        new Error('You are already on the waitlist for this slot.'),
        { status: 409, code: 'ALREADY_ON_WAITLIST' }
      )
    }
    throw err
  }
}

async function leaveWaitlist(waitlistId, studentId) {
  const wid = parseInt(waitlistId, 10)
  if (isNaN(wid)) {
    throw Object.assign(new Error('Invalid waitlist id.'), { status: 400, code: 'INVALID_ID' })
  }

  const { rows } = await pool.query(
    `UPDATE waitlist SET status = 'removed'
     WHERE id = $1 AND student_id = $2 AND status IN ('waiting', 'offered')
     RETURNING *`,
    [wid, studentId]
  )
  if (!rows[0]) {
    throw Object.assign(
      new Error('Waitlist entry not found or cannot be removed.'),
      { status: 404, code: 'NOT_FOUND' }
    )
  }
  // If the student declined an active offer, pass it to the next waiter
  if (rows[0].claim_offered_at) {
    try { await offerSlotToNext(rows[0].schedule_id, rows[0].session_date) } catch (_) {}
  }
  return rows[0]
}

async function claimSlot(waitlistId, studentId) {
  const wid = parseInt(waitlistId, 10)
  if (isNaN(wid)) {
    throw Object.assign(new Error('Invalid waitlist id.'), { status: 400, code: 'INVALID_ID' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: wRows } = await client.query(
      `SELECT w.id, w.schedule_id, w.session_date, w.status, w.claim_expires_at,
              s.trainer_id, s.gym_id, s.start_time, s.end_time, s.capacity
       FROM waitlist w
       JOIN schedules s ON s.id = w.schedule_id
       WHERE w.id = $1 AND w.student_id = $2
       FOR UPDATE`,
      [wid, studentId]
    )
    if (!wRows[0]) {
      throw Object.assign(new Error('Waitlist entry not found.'), { status: 404, code: 'NOT_FOUND' })
    }
    const entry = wRows[0]

    if (entry.status !== 'offered') {
      throw Object.assign(new Error('No active claim window for this entry.'), { status: 409, code: 'NOT_OFFERED' })
    }
    if (new Date(entry.claim_expires_at) < new Date()) {
      throw Object.assign(new Error('Your claim window has expired.'), { status: 409, code: 'CLAIM_EXPIRED' })
    }

    // Re-verify capacity inside the transaction. The FOR UPDATE above locks both
    // the waitlist row and the schedule row (via JOIN), so this count is stable.
    // Exclude this entry from the offered count — it is the one being claimed.
    const { rows: countRows } = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM bookings
          WHERE schedule_id = $1 AND session_date = $2
          AND status NOT IN ('cancelled_by_student', 'cancelled_by_trainer'))
         +
         (SELECT COUNT(*) FROM waitlist
          WHERE schedule_id = $1 AND session_date = $2 AND status = 'offered'
          AND id != $3)
       AS occupied`,
      [entry.schedule_id, entry.session_date, wid]
    )
    if (parseInt(countRows[0].occupied, 10) >= entry.capacity) {
      throw Object.assign(new Error('This slot is no longer available.'), { status: 409, code: 'SLOT_FULL' })
    }

    const { rows: bRows } = await client.query(
      `INSERT INTO bookings (schedule_id, student_id, trainer_id, gym_id, session_date, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed')
       RETURNING *`,
      [entry.schedule_id, studentId, entry.trainer_id, entry.gym_id,
       entry.session_date, entry.start_time, entry.end_time]
    )

    await client.query(
      `UPDATE waitlist SET status = 'claimed' WHERE id = $1`,
      [wid]
    )

    await client.query('COMMIT')
    return bRows[0]
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

async function listStudentWaitlist(studentId) {
  await processClaimExpiry()

  const { rows } = await pool.query(
    `SELECT w.id, w.schedule_id, w.session_date, w.position, w.status,
            w.claim_offered_at, w.claim_expires_at, w.created_at,
            s.day_of_week, s.start_time, s.end_time, s.session_type,
            u.first_name AS trainer_first_name, u.last_name AS trainer_last_name
     FROM waitlist w
     JOIN schedules s ON s.id = w.schedule_id
     JOIN users u ON u.id = s.trainer_id
     WHERE w.student_id = $1 AND w.status IN ('waiting', 'offered')
     ORDER BY w.created_at ASC`,
    [studentId]
  )
  return rows
}

module.exports = { joinWaitlist, leaveWaitlist, claimSlot, listStudentWaitlist, offerSlotToNext, processClaimExpiry }
