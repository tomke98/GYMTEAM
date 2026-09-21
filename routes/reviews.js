const express = require('express')
const reviewService = require('../services/review.service')
const authenticateToken = require('../middlewares/authenticate-token')
const requireRole = require('../middlewares/require-role')

const router = express.Router()

const SECURE_COOKIE = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIE, sameSite: 'lax' }

function setFlash(res, type, message) {
  res.cookie('flash', JSON.stringify({ type, message }), { ...COOKIE_BASE, maxAge: 5000 })
}

function handleReviewError(err, res, redirectTarget, next) {
  if (err.status === 400 || err.status === 403 || err.status === 409) {
    setFlash(res, 'error', err.message)
    return res.redirect(redirectTarget)
  }
  next(err)
}

// POST /trainer-reviews — student writes a trainer review
router.post('/trainer-reviews', authenticateToken, requireRole('student'), async (req, res, next) => {
  const { trainer_id, rating, comment } = req.body
  const tid = parseInt(trainer_id, 10)
  const redirectTarget = !isNaN(tid) ? `/trainers/${tid}` : '/trainers'
  try {
    await reviewService.createTrainerReview(req.user.userId, { trainerId: trainer_id, rating, comment })
    setFlash(res, 'success', 'Review submitted!')
    res.redirect(redirectTarget)
  } catch (err) {
    handleReviewError(err, res, redirectTarget, next)
  }
})

// POST /gym-reviews — student writes a gym review
router.post('/gym-reviews', authenticateToken, requireRole('student'), async (req, res, next) => {
  const { gym_id, rating, comment } = req.body
  const gid = parseInt(gym_id, 10)
  const redirectTarget = !isNaN(gid) ? `/gyms/${gid}` : '/gyms'
  try {
    await reviewService.createGymReview(req.user.userId, { gymId: gym_id, rating, comment })
    setFlash(res, 'success', 'Review submitted!')
    res.redirect(redirectTarget)
  } catch (err) {
    handleReviewError(err, res, redirectTarget, next)
  }
})

// POST /trainer-reviews/:id/edit — student edits their trainer review within 48h window
router.post('/trainer-reviews/:id/edit', authenticateToken, requireRole('student'), async (req, res, next) => {
  const { rating, comment } = req.body
  const tid = parseInt(req.body.trainer_id, 10)
  const redirectTarget = !isNaN(tid) ? `/trainers/${tid}` : '/trainers'
  try {
    await reviewService.editTrainerReview(req.user.userId, { reviewId: req.params.id, rating, comment })
    setFlash(res, 'success', 'Review updated.')
    res.redirect(redirectTarget)
  } catch (err) {
    handleReviewError(err, res, redirectTarget, next)
  }
})

// POST /gym-reviews/:id/edit — student edits their gym review within 48h window
router.post('/gym-reviews/:id/edit', authenticateToken, requireRole('student'), async (req, res, next) => {
  const { rating, comment } = req.body
  const gid = parseInt(req.body.gym_id, 10)
  const redirectTarget = !isNaN(gid) ? `/gyms/${gid}` : '/gyms'
  try {
    await reviewService.editGymReview(req.user.userId, { reviewId: req.params.id, rating, comment })
    setFlash(res, 'success', 'Review updated.')
    res.redirect(redirectTarget)
  } catch (err) {
    handleReviewError(err, res, redirectTarget, next)
  }
})

// POST /student-reviews — trainer writes a private student review
router.post('/student-reviews', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  const { subscription_id, rating_coachability, rating_consistency, comment } = req.body
  const redirectTarget = '/auth/trainer-dashboard'
  try {
    await reviewService.createStudentReview(req.user.userId, {
      subscriptionId: subscription_id,
      ratingCoachability: rating_coachability,
      ratingConsistency: rating_consistency,
      comment,
    })
    setFlash(res, 'success', 'Student review submitted!')
    res.redirect(redirectTarget)
  } catch (err) {
    handleReviewError(err, res, redirectTarget, next)
  }
})

// GET /students/:id — privacy-gated student review read
// Only trainers who have (or had) a subscription with this student may access.
router.get('/students/:id', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const studentId = parseInt(req.params.id, 10)
    if (isNaN(studentId)) {
      return next(Object.assign(new Error('Invalid student id.'), { status: 400, code: 'INVALID_ID' }))
    }
    const reviews = await reviewService.getStudentReviews(req.user.userId, studentId)
    res.json({ reviews })
  } catch (err) {
    next(err)
  }
})

module.exports = router
