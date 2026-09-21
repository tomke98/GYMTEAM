const express = require('express')
const gymSubscriptionService = require('../services/gym-subscription.service')
const authenticateToken = require('../middlewares/authenticate-token')
const requireRole = require('../middlewares/require-role')

const router = express.Router()

const SECURE_COOKIE = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIE, sameSite: 'lax' }

// GET /gym-subscriptions — student's gym subscription list
router.get('/', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const gymSubscriptions = await gymSubscriptionService.listStudentGymSubscriptions(req.user.userId)
    res.render('pages/gym-subscriptions/index', { title: 'My Gym Subscriptions', gymSubscriptions })
  } catch (err) {
    next(err)
  }
})

// POST /gym-subscriptions — student subscribes to gym
router.post('/', authenticateToken, requireRole('student'), async (req, res, next) => {
  const gymId = parseInt(req.body.gym_id, 10)
  if (isNaN(gymId)) {
    return next(Object.assign(new Error('Invalid gym id.'), { status: 400, code: 'INVALID_ID' }))
  }
  try {
    await gymSubscriptionService.createGymSubscription(req.user.userId, gymId)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Gym subscription created.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect(`/gyms/${gymId}`)
  } catch (err) {
    if (err.status === 409 || err.status === 404) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect(`/gyms/${gymId}`)
    }
    next(err)
  }
})

// POST /gym-subscriptions/:id/cancel — student cancels gym subscription
router.post('/:id/cancel', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const gymSubId = parseInt(req.params.id, 10)
    if (isNaN(gymSubId)) {
      return next(Object.assign(new Error('Invalid gym subscription id.'), { status: 400, code: 'INVALID_ID' }))
    }
    await gymSubscriptionService.cancelGymSubscription(gymSubId, req.user.userId)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Gym subscription cancelled.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/gym-subscriptions')
  } catch (err) {
    if (err.status === 404) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/gym-subscriptions')
    }
    next(err)
  }
})

module.exports = router
