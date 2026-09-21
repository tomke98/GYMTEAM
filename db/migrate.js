require('dotenv').config()
const fs = require('fs')
const path = require('path')
const pool = require('./pool')

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        executed_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    const migrationsDir = path.join(__dirname, 'migrations')
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT filename FROM schema_migrations WHERE filename = $1',
        [file]
      )
      if (rows.length > 0) {
        console.log(`Skipping ${file} (already migrated)`)
        continue
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
      } catch (migErr) {
        await client.query('ROLLBACK')
        throw migErr
      }
      console.log(`Migrated ${file}`)
    }
    console.log('All migrations complete')
  } catch (err) {
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
