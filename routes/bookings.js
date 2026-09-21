const express = require('express')
const bookingService = require('../services/booking.service')
const authenticateToken = require('../middlewares/authenticate-token')
const requireRole = require('../middlewares/require-role')

const router = express.Router()

const SECURE_COOKIE = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIE, sameSite: 'lax' }

// GET /bookings — student's bookings page
router.get('/', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const bookings = await bookingService.listStudentBookings(req.user.userId)
    res.render('pages/bookings/index', { title: 'My Bookings', bookings })
  } catch (err) { next(err) }
})

// POST /bookings — create booking
router.post('/', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const { schedule_id, session_date } = req.body
    await bookingService.createBooking(req.user.userId, { scheduleId: schedule_id, sessionDate: session_date })
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Session booked successfully.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/bookings')
  } catch (err) {
    if (err.status === 400 || err.status === 409 || err.status === 403) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      const tid = parseInt(req.body.trainer_id, 10)
      return res.redirect(!isNaN(tid) ? `/trainers/${tid}` : '/trainers')
    }
    next(err)
  }
})

// GET /bookings/trainer — trainer's bookings page (MUST be before /:id/cancel)
router.get('/trainer', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const bookings = await bookingService.listTrainerBookings(req.user.userId)
    res.render('pages/trainer/bookings', { title: 'My Bookings', bookings })
  } catch (err) { next(err) }
})

// POST /bookings/:id/cancel — cancel a booking (student or trainer)
router.post('/:id/cancel', authenticateToken, async (req, res, next) => {
  try {
    await bookingService.cancelBooking(req.params.id, req.user.userId, req.user.role)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Booking cancelled.' }), { ...COOKIE_BASE, maxAge: 5000 })
    const redirectTo = req.user.role === 'trainer' ? '/bookings/trainer' : '/bookings'
    return res.redirect(redirectTo)
  } catch (err) {
    if (err.status === 404 || err.status === 400) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      const redirectTo = req.user.role === 'trainer' ? '/bookings/trainer' : '/bookings'
      return res.redirect(redirectTo)
    }
    next(err)
  }
})

module.exports = router
