const express = require('express')
const subscriptionService = require('../services/subscription.service')
const authenticateToken = require('../middlewares/authenticate-token')
const requireRole = require('../middlewares/require-role')

const router = express.Router()

const SECURE_COOKIE = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIE, sameSite: 'lax' }

// GET /subscriptions — student's subscription list
router.get('/', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const subscriptions = await subscriptionService.listStudentSubscriptions(req.user.userId)
    res.render('pages/subscriptions/index', { title: 'My Subscriptions', subscriptions })
  } catch (err) {
    next(err)
  }
})

// POST /subscriptions — student sends subscription request to trainer
router.post('/', authenticateToken, requireRole('student'), async (req, res, next) => {
  const trainerId = parseInt(req.body.trainer_id, 10)
  if (isNaN(trainerId)) {
    return next(Object.assign(new Error('Invalid trainer id.'), { status: 400, code: 'INVALID_ID' }))
  }
  try {
    await subscriptionService.createSubscription(req.user.userId, trainerId)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Subscription request sent.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect(`/trainers/${trainerId}`)
  } catch (err) {
    if (err.status === 409) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect(`/trainers/${trainerId}`)
    }
    next(err)
  }
})

// GET /subscriptions/requests — trainer's incoming pending requests
// MUST be before /:id routes to prevent "requests" matching as an :id param
router.get('/requests', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const requests = await subscriptionService.listTrainerPendingRequests(req.user.userId)
    res.render('pages/trainer/requests', { title: 'Subscription Requests', requests })
  } catch (err) {
    next(err)
  }
})

// POST /subscriptions/:id/accept — trainer accepts a pending request
router.post('/:id/accept', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const subscriptionId = parseInt(req.params.id, 10)
    if (isNaN(subscriptionId)) {
      return next(Object.assign(new Error('Invalid subscription id.'), { status: 400, code: 'INVALID_ID' }))
    }
    await subscriptionService.acceptSubscription(subscriptionId, req.user.userId)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Subscription accepted.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/subscriptions/requests')
  } catch (err) {
    if (err.status === 404) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/subscriptions/requests')
    }
    next(err)
  }
})

// POST /subscriptions/:id/decline — trainer declines a pending request
router.post('/:id/decline', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const subscriptionId = parseInt(req.params.id, 10)
    if (isNaN(subscriptionId)) {
      return next(Object.assign(new Error('Invalid subscription id.'), { status: 400, code: 'INVALID_ID' }))
    }
    await subscriptionService.declineSubscription(subscriptionId, req.user.userId)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Subscription declined.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/subscriptions/requests')
  } catch (err) {
    if (err.status === 404) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/subscriptions/requests')
    }
    next(err)
  }
})

// POST /subscriptions/:id/cancel — student cancels their active subscription
router.post('/:id/cancel', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const subscriptionId = parseInt(req.params.id, 10)
    if (isNaN(subscriptionId)) {
      return next(Object.assign(new Error('Invalid subscription id.'), { status: 400, code: 'INVALID_ID' }))
    }
    await subscriptionService.cancelSubscription(subscriptionId, req.user.userId)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Subscription cancelled.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/subscriptions')
  } catch (err) {
    if (err.status === 404) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/subscriptions')
    }
    next(err)
  }
})

module.exports = router
