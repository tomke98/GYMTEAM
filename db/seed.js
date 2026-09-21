require('dotenv').config()
const bcrypt = require('bcryptjs')
const pool = require('./pool')

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@gymteam.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD environment variable is required to run seed')
  process.exit(1)
}

async function seed() {
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      "SELECT id FROM users WHERE email = $1 AND role = 'admin'",
      [ADMIN_EMAIL]
    )
    if (rows.length > 0) {
      console.log('Admin already exists, skipping seed')
      return
    }
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
    await client.query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name)
       VALUES ($1, $2, 'admin', 'GymTeam', 'Admin')`,
      [ADMIN_EMAIL, passwordHash]
    )
    console.log(`Admin seeded: ${ADMIN_EMAIL}`)
  } catch (err) {
    console.error('Seed failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()
