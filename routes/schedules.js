const express = require('express')
const scheduleService = require('../services/schedule.service')
const authenticateToken = require('../middlewares/authenticate-token')
const requireRole = require('../middlewares/require-role')

const router = express.Router()

const SECURE_COOKIE = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIE, sameSite: 'lax' }

// GET /trainers/me/schedules — management page
router.get('/me/schedules', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const schedules = await scheduleService.listTrainerSchedules(req.user.userId)
    res.render('pages/trainer/schedules', { title: 'Manage Schedule', schedules })
  } catch (err) {
    next(err)
  }
})

// POST /trainers/me/schedules — create slot
router.post('/me/schedules', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const { day_of_week, start_time, end_time, session_type, capacity, per_session_rate } = req.body
    await scheduleService.createSchedule(req.user.userId, {
      dayOfWeek: day_of_week,
      startTime: start_time,
      endTime: end_time,
      sessionType: session_type,
      capacity,
      perSessionRate: per_session_rate
    })
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Schedule slot created.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/trainers/me/schedules')
  } catch (err) {
    if (err.status === 400) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/trainers/me/schedules')
    }
    next(err)
  }
})

// GET /trainers/me/schedules/:id/edit — edit form (MUST come before /:id/schedules)
router.get('/me/schedules/:id/edit', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const scheduleId = parseInt(req.params.id, 10)
    if (isNaN(scheduleId)) return next(Object.assign(new Error('Invalid schedule id.'), { status: 400, code: 'INVALID_ID' }))
    const schedule = await scheduleService.getSchedule(scheduleId, req.user.userId)
    res.render('pages/trainer/schedule-edit', { title: 'Edit Schedule Slot', schedule })
  } catch (err) {
    next(err)
  }
})

// POST /trainers/me/schedules/:id — update slot
router.post('/me/schedules/:id', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  const scheduleId = parseInt(req.params.id, 10)
  if (isNaN(scheduleId)) return next(Object.assign(new Error('Invalid schedule id.'), { status: 400, code: 'INVALID_ID' }))
  try {
    const { day_of_week, start_time, end_time, session_type, capacity, per_session_rate } = req.body
    await scheduleService.updateSchedule(scheduleId, req.user.userId, {
      dayOfWeek: day_of_week,
      startTime: start_time,
      endTime: end_time,
      sessionType: session_type,
      capacity,
      perSessionRate: per_session_rate
    })
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Schedule slot updated.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/trainers/me/schedules')
  } catch (err) {
    if (err.status === 400) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect(`/trainers/me/schedules/${scheduleId}/edit`)
    }
    if (err.status === 404) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/trainers/me/schedules')
    }
    next(err)
  }
})

// POST /trainers/me/schedules/:id/delete — soft delete
router.post('/me/schedules/:id/delete', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const scheduleId = parseInt(req.params.id, 10)
    if (isNaN(scheduleId)) return next(Object.assign(new Error('Invalid schedule id.'), { status: 400, code: 'INVALID_ID' }))
    await scheduleService.deleteSchedule(scheduleId, req.user.userId)
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Schedule slot deleted.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/trainers/me/schedules')
  } catch (err) {
    if (err.status === 404) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/trainers/me/schedules')
    }
    next(err)
  }
})

module.exports = router
