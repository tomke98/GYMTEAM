const bcrypt = require('bcryptjs')
const pool = require('../db/pool')

async function register(firstName, lastName, email, password, role) {
  if (!firstName || !lastName || !email || !password || !role) {
    throw Object.assign(new Error('All fields are required.'), { status: 400, code: 'MISSING_FIELD' })
  }
  if (!['student', 'trainer'].includes(role)) {
    throw Object.assign(new Error('Invalid role. Must be student or trainer.'), { status: 400, code: 'INVALID_ROLE' })
  }
  const normalizedEmail = email.toLowerCase().trim()
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail])
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('An account with this email already exists.'), { status: 409, code: 'EMAIL_TAKEN' })
  }
  const passwordHash = await bcrypt.hash(password, 12)
  const { rows } = await pool.query(
    `INSERT INTO users (first_name, last_name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, role, first_name, last_name`,
    [firstName, lastName, normalizedEmail, passwordHash, role]
  )
  return rows[0]
}

async function login(email, password) {
  if (!email || !password) {
    throw Object.assign(new Error('Email and password are required.'), { status: 400, code: 'MISSING_FIELD' })
  }
  const normalizedEmail = email.toLowerCase().trim()
  const { rows } = await pool.query(
    'SELECT id, email, role, first_name, last_name, password_hash, is_active FROM users WHERE email = $1',
    [normalizedEmail]
  )
  const user = rows[0]
  const invalidCreds = () => Object.assign(new Error('Invalid email or password.'), { status: 401, code: 'INVALID_CREDENTIALS' })
  if (!user) throw invalidCreds()
  if (!user.is_active) {
    throw Object.assign(new Error('This account has been deactivated.'), { status: 403, code: 'ACCOUNT_INACTIVE' })
  }
  const match = await bcrypt.compare(password, user.password_hash)
  if (!match) throw invalidCreds()
  return { id: user.id, email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name }
}

async function getProfile(userId) {
  const { rows } = await pool.query(
    'SELECT id, first_name, last_name, email, role FROM users WHERE id = $1',
    [userId]
  )
  if (!rows[0]) throw Object.assign(new Error('User not found.'), { status: 404, code: 'USER_NOT_FOUND' })
  return rows[0]
}

async function updateProfile(userId, { firstName, lastName, newPassword }) {
  if (!firstName?.trim() || !lastName?.trim()) {
    throw Object.assign(new Error('First name and last name are required.'), { status: 400, code: 'MISSING_FIELD' })
  }
  if (newPassword && newPassword.trim() !== '') {
    const passwordHash = await bcrypt.hash(newPassword, 12)
    await pool.query(
      'UPDATE users SET first_name=$1, last_name=$2, password_hash=$3, updated_at=NOW() WHERE id=$4',
      [firstName.trim(), lastName.trim(), passwordHash, userId]
    )
  } else {
    await pool.query(
      'UPDATE users SET first_name=$1, last_name=$2, updated_at=NOW() WHERE id=$3',
      [firstName.trim(), lastName.trim(), userId]
    )
  }
}

async function deleteAccount(userId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE subscriptions
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE (student_id = $1 OR trainer_id = $1)
         AND status IN ('active', 'pending')`,
      [userId]
    )
    await client.query(
      `UPDATE gym_subscriptions
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE student_id = $1
         AND status = 'active'`,
      [userId]
    )
    await client.query('DELETE FROM users WHERE id = $1', [userId])
    await client.query('COMMIT')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch (_) {}
    throw err
  } finally {
    client.release()
  }
}

module.exports = { register, login, getProfile, updateProfile, deleteAccount }
