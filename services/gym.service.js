const pool = require('../db/pool')

function sanitizeUrl(url) {
  if (!url) return null
  if (url.startsWith('/uploads/')) return url
  try {
    const { protocol } = new URL(url)
    return (protocol === 'http:' || protocol === 'https:') ? url : null
  } catch { return null }
}

function calcGymStatus(name, address, openingTime, monthlyPrice, deactivate = false) {
  if (deactivate) return 'inactive'
  if (name?.trim() && address?.trim() && openingTime && monthlyPrice) return 'active'
  return 'incomplete'
}

async function getTrainerGym(trainerId) {
  const { rows } = await pool.query('SELECT * FROM gyms WHERE trainer_id = $1', [trainerId])
  return rows[0] || null
}

async function createGym(trainerId, {
  name, address, openingTime, closingTime, workingDays,
  monthlyPrice, yearlyPrice, description, photoUrls
}) {
  const existing = await pool.query('SELECT id FROM gyms WHERE trainer_id = $1', [trainerId])
  if (existing.rows[0]) {
    throw Object.assign(new Error('A gym listing already exists for this trainer.'), { status: 409, code: 'GYM_EXISTS' })
  }
  if (!name?.trim() || !address?.trim()) {
    throw Object.assign(new Error('Name and address are required.'), { status: 400, code: 'MISSING_FIELD' })
  }
  const status = calcGymStatus(name, address, openingTime, monthlyPrice)
  const safePhotoUrls = (photoUrls || []).map(sanitizeUrl).filter(Boolean)
  let rows
  try {
    ;({ rows } = await pool.query(`
      INSERT INTO gyms (trainer_id, name, address, opening_time, closing_time, working_days,
        monthly_price, yearly_price, description, photo_urls, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      trainerId, name.trim(), address.trim(),
      openingTime || null, closingTime || null,
      Array.isArray(workingDays) ? JSON.stringify(workingDays) : null,
      monthlyPrice || null, yearlyPrice || null,
      description || null,
      safePhotoUrls.length ? JSON.stringify(safePhotoUrls) : null,
      status
    ]))
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(new Error('A gym listing already exists for this trainer.'), { status: 409, code: 'GYM_EXISTS' })
    }
    throw err
  }
  return rows[0]
}

async function getGym(gymId) {
  const { rows: gymRows } = await pool.query('SELECT * FROM gyms WHERE id = $1', [gymId])
  if (!gymRows[0]) {
    throw Object.assign(new Error('Gym not found.'), { status: 404, code: 'GYM_NOT_FOUND' })
  }
  const gym = gymRows[0]

  const { rows: reviews } = await pool.query(`
    SELECT gr.id, gr.rating, gr.comment, gr.created_at, gr.edited_at,
           u.first_name, u.last_name
    FROM gym_reviews gr
    JOIN users u ON u.id = gr.reviewer_id
    WHERE gr.gym_id = $1 AND gr.is_deleted = FALSE
    ORDER BY gr.created_at DESC
  `, [gymId])
  gym.reviews = reviews

  return gym
}

async function updateGym(gymId, trainerId, {
  name, address, openingTime, closingTime, workingDays,
  monthlyPrice, yearlyPrice, description, photoUrls
}) {
  const { rows: existing } = await pool.query('SELECT trainer_id FROM gyms WHERE id = $1', [gymId])
  if (!existing[0]) {
    throw Object.assign(new Error('Gym not found.'), { status: 404, code: 'GYM_NOT_FOUND' })
  }
  if (String(existing[0].trainer_id) !== String(trainerId)) {
    throw Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' })
  }
  if (!name?.trim() || !address?.trim()) {
    throw Object.assign(new Error('Name and address are required.'), { status: 400, code: 'MISSING_FIELD' })
  }
  const status = calcGymStatus(name, address, openingTime, monthlyPrice)
  const safePhotoUrls = (photoUrls || []).map(sanitizeUrl).filter(Boolean)
  const { rows } = await pool.query(`
    UPDATE gyms SET
      name=$1, address=$2, opening_time=$3, closing_time=$4, working_days=$5,
      monthly_price=$6, yearly_price=$7, description=$8, photo_urls=$9,
      status=$10, updated_at=NOW()
    WHERE id=$11 AND trainer_id=$12
    RETURNING *
  `, [
    name.trim(), address.trim(),
    openingTime || null, closingTime || null,
    Array.isArray(workingDays) ? JSON.stringify(workingDays) : null,
    monthlyPrice || null, yearlyPrice || null,
    description || null,
    safePhotoUrls.length ? JSON.stringify(safePhotoUrls) : null,
    status, gymId, trainerId
  ])
  return rows[0]
}

async function deactivateGym(gymId, trainerId) {
  const { rows: existing } = await pool.query('SELECT trainer_id FROM gyms WHERE id = $1', [gymId])
  if (!existing[0]) {
    throw Object.assign(new Error('Gym not found.'), { status: 404, code: 'GYM_NOT_FOUND' })
  }
  if (String(existing[0].trainer_id) !== String(trainerId)) {
    throw Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' })
  }
  const { rows } = await pool.query(
    "UPDATE gyms SET status = 'inactive', updated_at = NOW() WHERE id = $1 RETURNING *",
    [gymId]
  )
  return rows[0]
}

async function listGyms() {
  const { rows } = await pool.query(`
    SELECT g.id, g.name, g.address, g.monthly_price, g.average_rating, g.review_count,
           g.photo_urls, g.status
    FROM gyms g
    WHERE g.status = 'active'
    ORDER BY g.average_rating DESC NULLS LAST, g.name
  `)
  return rows
}

module.exports = { getTrainerGym, createGym, getGym, updateGym, deactivateGym, listGyms }
