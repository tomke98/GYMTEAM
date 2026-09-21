const express = require('express')
const waitlistService = require('../services/waitlist.service')
const authenticateToken = require('../middlewares/authenticate-token')
const requireRole = require('../middlewares/require-role')

const router = express.Router()

const SECURE_COOKIE = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIE, sameSite: 'lax' }

// GET /waitlist — student's waitlist page
router.get('/', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    const entries = await waitlistService.listStudentWaitlist(req.user.userId)
    res.render('pages/waitlist/index', { title: 'My Waitlist', entries })
  } catch (err) { next(err) }
})

// POST /waitlist — join waitlist
router.post('/', authenticateToken, requireRole('student'), async (req, res, next) => {
  const { schedule_id, session_date, trainer_id } = req.body
  try {
    await waitlistService.joinWaitlist(req.user.userId, { scheduleId: schedule_id, sessionDate: session_date })
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Added to waitlist.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/waitlist')
  } catch (err) {
    if (err.status === 400 || err.status === 403 || err.status === 404 || err.status === 409) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      const tid = parseInt(trainer_id, 10)
      return res.redirect(!isNaN(tid) ? `/trainers/${tid}` : '/trainers')
    }
    next(err)
  }
})

// POST /waitlist/:id/claim — claim offered slot
router.post('/:id/claim', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    await waitlistService.claimSlot(req.params.id, req.user.userId)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Slot claimed! Booking confirmed.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/bookings')
  } catch (err) {
    if (err.status === 404 || err.status === 409 || err.status === 400) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/waitlist')
    }
    next(err)
  }
})

// POST /waitlist/:id/leave — leave waitlist (only status='waiting')
router.post('/:id/leave', authenticateToken, requireRole('student'), async (req, res, next) => {
  try {
    await waitlistService.leaveWaitlist(req.params.id, req.user.userId)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Removed from waitlist.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/waitlist')
  } catch (err) {
    if (err.status === 404 || err.status === 400) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/waitlist')
    }
    next(err)
  }
})

module.exports = router
