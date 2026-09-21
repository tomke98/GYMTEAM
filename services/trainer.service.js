const pool = require('../db/pool')

function sanitizeUrl(url) {
  if (!url) return null
  if (url.startsWith('/uploads/')) return url
  try {
    const { protocol } = new URL(url)
    return (protocol === 'http:' || protocol === 'https:') ? url : null
  } catch { return null }
}

async function getOrInitTrainerProfile(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM trainer_profiles WHERE id = $1',
    [userId]
  )
  return rows[0] || null
}

async function upsertTrainerProfile(userId, {
  bio, certification, cprCertified, liabilityInsurance,
  perSessionRate, monthlyRate, photoUrl,
  whatsapp, emailContact, instagramUrl, websiteUrl
}) {
  const safePhotoUrl = sanitizeUrl(photoUrl)
  const safeInstagramUrl = sanitizeUrl(instagramUrl)
  const safeWebsiteUrl = sanitizeUrl(websiteUrl)
  const isComplete = !!(bio?.trim() && certification && perSessionRate && safePhotoUrl)
  const cpr = cprCertified === true || cprCertified === 'true'
  const insurance = liabilityInsurance === true || liabilityInsurance === 'true'

  const { rows } = await pool.query(`
    INSERT INTO trainer_profiles (
      id, bio, certification, cpr_certified, liability_insurance,
      per_session_rate, monthly_rate, photo_url, whatsapp, email_contact,
      instagram_url, website_url, is_profile_complete, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
    ON CONFLICT (id) DO UPDATE SET
      bio                 = EXCLUDED.bio,
      certification       = EXCLUDED.certification,
      cpr_certified       = EXCLUDED.cpr_certified,
      liability_insurance = EXCLUDED.liability_insurance,
      per_session_rate    = EXCLUDED.per_session_rate,
      monthly_rate        = EXCLUDED.monthly_rate,
      photo_url           = EXCLUDED.photo_url,
      whatsapp            = EXCLUDED.whatsapp,
      email_contact       = EXCLUDED.email_contact,
      instagram_url       = EXCLUDED.instagram_url,
      website_url         = EXCLUDED.website_url,
      is_profile_complete = EXCLUDED.is_profile_complete,
      updated_at          = NOW()
    RETURNING *
  `, [
    userId,
    bio || null, certification || null,
    cpr, insurance,
    perSessionRate || null, monthlyRate || null, safePhotoUrl,
    whatsapp || null, emailContact || null,
    safeInstagramUrl, safeWebsiteUrl,
    isComplete
  ])
  return rows[0]
}

async function getTrainerPublicProfile(trainerId) {
  const { rows: profileRows } = await pool.query(`
    SELECT tp.*, u.first_name, u.last_name
    FROM trainer_profiles tp
    JOIN users u ON u.id = tp.id
    WHERE tp.id = $1 AND u.is_active = TRUE
  `, [trainerId])

  if (!profileRows[0]) {
    throw Object.assign(new Error('Trainer profile not found.'), { status: 404, code: 'TRAINER_NOT_FOUND' })
  }
  const profile = profileRows[0]

  const { rows: gymRows } = await pool.query(
    "SELECT id, name, address FROM gyms WHERE trainer_id = $1 AND status = 'active'",
    [trainerId]
  )
  profile.gym = gymRows[0] || null

  const { rows: schedules } = await pool.query(
    'SELECT * FROM schedules WHERE trainer_id = $1 AND is_active = TRUE ORDER BY day_of_week, start_time',
    [trainerId]
  )
  profile.schedules = schedules

  const { rows: reviews } = await pool.query(`
    SELECT tr.id, tr.rating, tr.comment, tr.created_at, tr.edited_at,
           u.first_name, u.last_name
    FROM trainer_reviews tr
    JOIN users u ON u.id = tr.reviewer_id
    WHERE tr.trainer_id = $1 AND tr.is_deleted = FALSE
    ORDER BY tr.created_at DESC
  `, [trainerId])
  profile.reviews = reviews

  return profile
}

async function listTrainers({ gym, minRating, certification } = {}) {
  const conditions = ["u.is_active = TRUE"]
  const params = []

  if (minRating) {
    const rating = parseFloat(minRating)
    if (!isNaN(rating)) {
      params.push(rating)
      conditions.push(`tp.average_rating >= $${params.length}`)
    }
  }
  if (certification) {
    params.push(certification)
    conditions.push(`tp.certification = $${params.length}`)
  }
  if (gym) {
    const gymId = parseInt(gym, 10)
    if (!isNaN(gymId)) {
      params.push(gymId)
      conditions.push(`g.id = $${params.length}`)
    }
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const { rows } = await pool.query(`
    SELECT tp.id, tp.photo_url, tp.certification, tp.per_session_rate,
           tp.average_rating, tp.review_count, tp.is_profile_complete,
           u.first_name, u.last_name,
           g.id AS gym_id, g.name AS gym_name
    FROM trainer_profiles tp
    JOIN users u ON u.id = tp.id
    LEFT JOIN gyms g ON g.trainer_id = tp.id AND g.status = 'active'
    ${where}
    ORDER BY tp.average_rating DESC NULLS LAST, u.last_name
  `, params)
  return rows
}

module.exports = { getOrInitTrainerProfile, upsertTrainerProfile, getTrainerPublicProfile, listTrainers }
