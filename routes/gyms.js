const express = require('express')
const gymService = require('../services/gym.service')
const gymSubscriptionService = require('../services/gym-subscription.service')
const reviewService = require('../services/review.service')
const authenticateToken = require('../middlewares/authenticate-token')
const requireRole = require('../middlewares/require-role')
const upload = require('../middlewares/upload')

const router = express.Router()

const SECURE_COOKIE = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIE, sameSite: 'lax' }

function parseBodyToServiceData(body, uploadedFiles = []) {
  const existingUrls = (body.existing_photo_urls || '').split(',').map(s => s.trim()).filter(Boolean)
  const newUrls = uploadedFiles.map(f => `/uploads/${f.filename}`)
  const photoUrls = newUrls.length > 0 ? newUrls : existingUrls
  let workingDays = body.working_days || []
  if (!Array.isArray(workingDays)) workingDays = [workingDays]
  return {
    name: body.name,
    address: body.address,
    openingTime: body.opening_time || null,
    closingTime: body.closing_time || null,
    workingDays,
    monthlyPrice: body.monthly_price || null,
    yearlyPrice: body.yearly_price || null,
    description: body.description || null,
    photoUrls
  }
}

// GET /gyms/new — MUST come before /:id
router.get('/new', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const gym = await gymService.getTrainerGym(req.user.userId)
    if (gym) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: 'You already have a gym listing.' }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect(`/gyms/${gym.id}/edit`)
    }
    res.render('pages/gyms/new', { title: 'Create Gym Listing' })
  } catch (err) {
    next(err)
  }
})

// GET /gyms/me — smart redirect
router.get('/me', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const gym = await gymService.getTrainerGym(req.user.userId)
    res.redirect(gym ? `/gyms/${gym.id}/edit` : '/gyms/new')
  } catch (err) {
    next(err)
  }
})

// POST /gyms — create gym
router.post('/', authenticateToken, requireRole('trainer'), upload.array('photo_files', 5), async (req, res, next) => {
  try {
    const gym = await gymService.createGym(req.user.userId, parseBodyToServiceData(req.body, req.files || []))
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Gym listing created.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect(`/gyms/${gym.id}/edit`)
  } catch (err) {
    if (err.status === 400 || err.status === 409) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/gyms/new')
    }
    next(err)
  }
})

// GET /gyms/:id/edit — MUST come before /:id
router.get('/:id/edit', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const gymId = parseInt(req.params.id, 10)
    if (isNaN(gymId)) return next(Object.assign(new Error('Invalid gym id.'), { status: 400, code: 'INVALID_ID' }))
    const gym = await gymService.getGym(gymId)
    if (String(gym.trainer_id) !== String(req.user.userId)) {
      return next(Object.assign(new Error('Forbidden.'), { status: 403, code: 'FORBIDDEN' }))
    }
    res.render('pages/gyms/edit', { title: 'Edit Gym Listing', gym })
  } catch (err) {
    next(err)
  }
})

// POST /gyms/:id/deactivate — MUST come before /:id
router.post('/:id/deactivate', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const gymId = parseInt(req.params.id, 10)
    if (isNaN(gymId)) return next(Object.assign(new Error('Invalid gym id.'), { status: 400, code: 'INVALID_ID' }))
    await gymService.deactivateGym(gymId, req.user.userId)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Gym listing deactivated.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect(`/gyms/${gymId}/edit`)
  } catch (err) {
    if (err.status === 403) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect(`/gyms/${gymId}/edit`)
    }
    next(err)
  }
})

// POST /gyms/:id — update gym
router.post('/:id', authenticateToken, requireRole('trainer'), upload.array('photo_files', 5), async (req, res, next) => {
  try {
    const gymId = parseInt(req.params.id, 10)
    if (isNaN(gymId)) return next(Object.assign(new Error('Invalid gym id.'), { status: 400, code: 'INVALID_ID' }))
    await gymService.updateGym(gymId, req.user.userId, parseBodyToServiceData(req.body, req.files || []))
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Gym listing saved.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect(`/gyms/${gymId}/edit`)
  } catch (err) {
    if (err.status === 400 || err.status === 403) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect(`/gyms/${gymId}/edit`)
    }
    next(err)
  }
})

// GET /gyms — browse all active gyms
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const gyms = await gymService.listGyms()
    res.render('pages/gyms/index', { title: 'Browse Gyms', gyms })
  } catch (err) {
    next(err)
  }
})

// GET /gyms/:id — public gym detail
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const gymId = parseInt(req.params.id, 10)
    if (isNaN(gymId)) return next(Object.assign(new Error('Invalid gym id.'), { status: 400, code: 'INVALID_ID' }))
    const gym = await gymService.getGym(gymId)
    let gymSubscription = null
    let reviewContext = { qualifyingSubscription: null, existingReview: null }
    if (req.user.role === 'student') {
      gymSubscription = await gymSubscriptionService.getStudentGymSubscription(req.user.userId, gymId)
      // Pass gymSubscription when active to skip the redundant gym_subscriptions re-query;
      // undefined falls back to the service's own query (which also covers cancelled subs).
      reviewContext = await reviewService.getStudentGymReviewContext(req.user.userId, gymId, gymSubscription ?? undefined)
    }
    res.render('pages/gyms/show', { title: gym.name, gym, gymSubscription, reviewContext })
  } catch (err) {
    next(err)
  }
})

module.exports = router
