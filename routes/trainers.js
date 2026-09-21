const express = require('express')
const trainerService = require('../services/trainer.service')
const gymService = require('../services/gym.service')
const subscriptionService = require('../services/subscription.service')
const reviewService = require('../services/review.service')
const authenticateToken = require('../middlewares/authenticate-token')
const requireRole = require('../middlewares/require-role')
const upload = require('../middlewares/upload')

const router = express.Router()

const SECURE_COOKIE = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIE, sameSite: 'lax' }

// GET /trainers — browse all trainers with optional filters
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const [trainers, gyms] = await Promise.all([
      trainerService.listTrainers(req.query),
      gymService.listGyms()
    ])
    res.render('pages/trainers/index', {
      title: 'Browse Trainers',
      trainers,
      gyms,
      filters: {
        gym: req.query.gym || '',
        minRating: req.query.minRating || '',
        certification: req.query.certification || ''
      }
    })
  } catch (err) {
    next(err)
  }
})

// GET /trainers/me/edit — MUST come before /:id
router.get('/me/edit', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const profile = await trainerService.getOrInitTrainerProfile(req.user.userId)
    res.render('pages/trainers/edit', { title: 'Edit Trainer Profile', profile })
  } catch (err) {
    next(err)
  }
})

// POST /trainers/me — update trainer profile
router.post('/me', authenticateToken, requireRole('trainer'), upload.single('photo_file'), async (req, res, next) => {
  try {
    const {
      bio, certification, cpr_certified, liability_insurance,
      per_session_rate, monthly_rate, photo_url,
      whatsapp, email_contact, instagram_url, website_url
    } = req.body
    const photoUrl = req.file ? `/uploads/${req.file.filename}` : photo_url
    await trainerService.upsertTrainerProfile(req.user.userId, {
      bio, certification,
      cprCertified: cpr_certified,
      liabilityInsurance: liability_insurance,
      perSessionRate: per_session_rate,
      monthlyRate: monthly_rate,
      photoUrl,
      whatsapp,
      emailContact: email_contact,
      instagramUrl: instagram_url,
      websiteUrl: website_url
    })
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Trainer profile saved.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/trainers/me/edit')
  } catch (err) {
    if (err.status === 400) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/trainers/me/edit')
    }
    next(err)
  }
})

// GET /trainers/:id — public trainer profile
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const trainerId = parseInt(req.params.id, 10)
    if (isNaN(trainerId)) {
      return next(Object.assign(new Error('Invalid trainer id.'), { status: 400, code: 'INVALID_ID' }))
    }
    const trainer = await trainerService.getTrainerPublicProfile(trainerId)
    let subscription = null
    let isBlocked = false
    let reviewContext = { qualifyingSubscription: null, existingReview: null }
    if (req.user.role === 'student') {
      subscription = await subscriptionService.getStudentTrainerSubscription(req.user.userId, trainerId)
      if (!subscription || !['active', 'pending'].includes(subscription.status)) {
        isBlocked = await subscriptionService.checkReApplicationBlock(req.user.userId, trainerId)
      }
      // Pass subscription directly when it has a qualifying status to skip the re-query;
      // undefined falls back to the service's own query for pending/null cases.
      const QUALIFYING_TRAINER_SUB_STATUSES = ['active', 'cancelled', 'expired']
      const preloadedSub = subscription && QUALIFYING_TRAINER_SUB_STATUSES.includes(subscription.status)
        ? subscription
        : undefined
      reviewContext = await reviewService.getStudentTrainerReviewContext(req.user.userId, trainerId, preloadedSub)
    }
    res.render('pages/trainers/show', { title: `${trainer.first_name} ${trainer.last_name}`, trainer, subscription, isBlocked, reviewContext })
  } catch (err) {
    next(err)
  }
})

module.exports = router
