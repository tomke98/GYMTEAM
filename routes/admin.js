const express = require('express')
const adminService = require('../services/admin.service')
const reviewService = require('../services/review.service')
const authenticateToken = require('../middlewares/authenticate-token')
const requireRole = require('../middlewares/require-role')

const router = express.Router()
router.use(authenticateToken, requireRole('admin'))

const SECURE_COOKIE = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIE, sameSite: 'lax' }

function setFlash(res, type, message) {
  res.cookie('flash', JSON.stringify({ type, message }), { ...COOKIE_BASE, maxAge: 5000 })
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const stats = await adminService.adminGetStats()
    res.render('pages/admin/dashboard', { title: 'Admin Dashboard', stats })
  } catch (err) {
    next(err)
  }
})

// ─── Users ────────────────────────────────────────────────────────────────────

router.get('/users', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const { users, total, pageSize } = await adminService.adminListUsers({ page })
    const totalPages = Math.ceil(total / pageSize) || 1
    res.render('pages/admin/users', { title: 'Admin — Users', users, page, totalPages })
  } catch (err) {
    next(err)
  }
})

router.post('/users', async (req, res, next) => {
  try {
    await adminService.adminCreateUser({
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      email: req.body.email,
      password: req.body.password,
      role: req.body.role
    })
    setFlash(res, 'success', 'User created.')
    res.redirect('/admin/users')
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/users')
    }
    next(err)
  }
})

// Specific action routes BEFORE the generic /:id update route (route order matters)
router.post('/users/:id/deactivate', async (req, res, next) => {
  if (String(req.params.id) === String(req.user.userId)) {
    setFlash(res, 'error', 'You cannot deactivate your own account.')
    return res.redirect('/admin/users')
  }
  try {
    await adminService.adminSetUserActive(req.params.id, false)
    setFlash(res, 'success', 'User deactivated.')
    res.redirect('/admin/users')
  } catch (err) {
    if (err.status === 404) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/users')
    }
    next(err)
  }
})

router.post('/users/:id/activate', async (req, res, next) => {
  try {
    await adminService.adminSetUserActive(req.params.id, true)
    setFlash(res, 'success', 'User activated.')
    res.redirect('/admin/users')
  } catch (err) {
    if (err.status === 404) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/users')
    }
    next(err)
  }
})

router.post('/users/:id/delete', async (req, res, next) => {
  if (String(req.params.id) === String(req.user.userId)) {
    setFlash(res, 'error', 'You cannot delete your own account.')
    return res.redirect('/admin/users')
  }
  try {
    await adminService.adminDeleteUser(req.params.id)
    setFlash(res, 'success', 'User deleted.')
    res.redirect('/admin/users')
  } catch (err) {
    if (err.status === 404) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/users')
    }
    next(err)
  }
})

router.post('/users/:id/delete-trainer-profile', async (req, res, next) => {
  try {
    await adminService.adminDeleteTrainerProfile(req.params.id)
    setFlash(res, 'success', 'Trainer profile deleted. Gym listing remains intact.')
    res.redirect('/admin/users')
  } catch (err) {
    if (err.status === 404) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/users')
    }
    next(err)
  }
})

// Generic update — registered after specific action routes
router.post('/users/:id', async (req, res, next) => {
  try {
    await adminService.adminUpdateUser(req.params.id, {
      firstName: req.body.first_name,
      lastName: req.body.last_name,
      email: req.body.email
    })
    setFlash(res, 'success', 'User updated.')
    res.redirect('/admin/users')
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/users')
    }
    next(err)
  }
})

// ─── Gyms ─────────────────────────────────────────────────────────────────────

router.get('/gyms', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const { gyms, total, pageSize } = await adminService.adminListGyms({ page })
    const totalPages = Math.ceil(total / pageSize) || 1
    res.render('pages/admin/gyms', { title: 'Admin — Gyms', gyms, page, totalPages })
  } catch (err) {
    next(err)
  }
})

router.post('/gyms/:id/delete', async (req, res, next) => {
  try {
    await adminService.adminDeleteGym(req.params.id)
    setFlash(res, 'success', 'Gym deleted.')
    res.redirect('/admin/gyms')
  } catch (err) {
    if (err.status === 404) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/gyms')
    }
    next(err)
  }
})

// ─── Alerts ──────────────────────────────────────────────────────────────────

router.get('/alerts', async (req, res, next) => {
  try {
    const alerts = await adminService.adminGetCancellationAlerts()
    res.render('pages/admin/alerts', {
      title: 'Admin — Cancellation Alerts',
      alerts,
      threshold: adminService.CANCELLATION_ALERT_THRESHOLD,
      windowDays: adminService.CANCELLATION_ALERT_WINDOW_DAYS
    })
  } catch (err) {
    next(err)
  }
})

// ─── Reviews ──────────────────────────────────────────────────────────────────

// GET /admin/reviews — list all trainer + gym reviews including soft-deleted
router.get('/reviews', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const { reviews, total, pageSize } = await adminService.adminListReviews({ page })
    const totalPages = Math.ceil(total / pageSize) || 1
    res.render('pages/admin/reviews', { title: 'Admin — Reviews', reviews, page, totalPages })
  } catch (err) {
    next(err)
  }
})

// POST /admin/reviews/trainer-reviews/:id/delete — soft-delete a trainer review
router.post('/reviews/trainer-reviews/:id/delete', async (req, res, next) => {
  try {
    await reviewService.softDeleteReview(req.user.userId, { reviewType: 'trainer', reviewId: req.params.id })
    setFlash(res, 'success', 'Review deleted.')
    res.redirect('/admin/reviews')
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/reviews')
    }
    next(err)
  }
})

// POST /admin/reviews/gym-reviews/:id/delete — soft-delete a gym review
router.post('/reviews/gym-reviews/:id/delete', async (req, res, next) => {
  try {
    await reviewService.softDeleteReview(req.user.userId, { reviewType: 'gym', reviewId: req.params.id })
    setFlash(res, 'success', 'Review deleted.')
    res.redirect('/admin/reviews')
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/reviews')
    }
    next(err)
  }
})

// POST /admin/reviews/trainer-reviews/:id/restore — restore a soft-deleted trainer review
router.post('/reviews/trainer-reviews/:id/restore', async (req, res, next) => {
  try {
    await reviewService.restoreReview(req.user.userId, { reviewType: 'trainer', reviewId: req.params.id })
    setFlash(res, 'success', 'Review restored.')
    res.redirect('/admin/reviews')
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/reviews')
    }
    next(err)
  }
})

// POST /admin/reviews/gym-reviews/:id/restore — restore a soft-deleted gym review
router.post('/reviews/gym-reviews/:id/restore', async (req, res, next) => {
  try {
    await reviewService.restoreReview(req.user.userId, { reviewType: 'gym', reviewId: req.params.id })
    setFlash(res, 'success', 'Review restored.')
    res.redirect('/admin/reviews')
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/reviews')
    }
    next(err)
  }
})

// POST /admin/reviews/student-reviews/:id/delete — soft-delete a student review
router.post('/reviews/student-reviews/:id/delete', async (req, res, next) => {
  try {
    await reviewService.softDeleteReview(req.user.userId, { reviewType: 'student', reviewId: req.params.id })
    setFlash(res, 'success', 'Review deleted.')
    res.redirect('/admin/reviews')
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/reviews')
    }
    next(err)
  }
})

// POST /admin/reviews/student-reviews/:id/restore — restore a soft-deleted student review
router.post('/reviews/student-reviews/:id/restore', async (req, res, next) => {
  try {
    await reviewService.restoreReview(req.user.userId, { reviewType: 'student', reviewId: req.params.id })
    setFlash(res, 'success', 'Review restored.')
    res.redirect('/admin/reviews')
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 409) {
      setFlash(res, 'error', err.message)
      return res.redirect('/admin/reviews')
    }
    next(err)
  }
})

module.exports = router
