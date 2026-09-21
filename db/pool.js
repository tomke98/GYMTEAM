require('dotenv').config()
const { Pool, types } = require('pg')

// postgres-date parses DATE (OID 1082) as local midnight via new Date(y,m,d),
// which shifts to the previous UTC day on UTC+ servers. Return the raw "YYYY-MM-DD"
// string so callers can safely do new Date("YYYY-MM-DD") which is UTC midnight per spec.
types.setTypeParser(1082, val => val)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10
})

module.exports = pool
