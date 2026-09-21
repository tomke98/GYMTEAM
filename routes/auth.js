const crypto = require('crypto')
const express = require('express')
const jwt = require('jsonwebtoken')
const authService = require('../services/auth.service')
const subscriptionService = require('../services/subscription.service')
const authenticateToken = require('../middlewares/authenticate-token')
const requireRole = require('../middlewares/require-role')
const adminService = require('../services/admin.service')

const router = express.Router()

const JWT_7D_MS = 7 * 24 * 60 * 60 * 1000
const SECURE_COOKIE = process.env.NODE_ENV === 'production'
const COOKIE_BASE = { httpOnly: true, secure: SECURE_COOKIE, sameSite: 'lax' }
const DASHBOARD = {
  student: '/auth/student-dashboard',
  trainer: '/auth/trainer-dashboard',
  admin:   '/auth/admin-dashboard',
}

router.get('/register', (req, res) => {
  res.render('pages/auth/register', { title: 'Register' })
})

router.post('/register', async (req, res, next) => {
  try {
    const { first_name, last_name, email, password, role } = req.body
    const user = await authService.register(first_name, last_name, email, password, role)
    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.cookie('token', token, { ...COOKIE_BASE, maxAge: JWT_7D_MS })
    res.redirect(DASHBOARD[user.role] || '/')
  } catch (err) {
    if (err.status === 400 || err.status === 409) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/auth/register')
    }
    next(err)
  }
})

router.get('/login', (req, res) => {
  if (res.locals.user) return res.redirect(DASHBOARD[res.locals.user.role] || '/')
  res.render('pages/auth/login', { title: 'Log In' })
})

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body
    const user = await authService.login(email, password)
    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.cookie('token', token, { ...COOKIE_BASE, maxAge: JWT_7D_MS })
    res.redirect(DASHBOARD[user.role] || '/')
  } catch (err) {
    if (err.status === 400 || err.status === 401 || err.status === 403) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/auth/login')
    }
    next(err)
  }
})

router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_BASE)
  res.redirect('/auth/login')
})

router.get('/profile', authenticateToken, async (req, res, next) => {
  try {
    const user = await authService.getProfile(req.user.userId)
    const csrfToken = crypto.randomBytes(32).toString('hex')
    res.cookie('_csrf', csrfToken, COOKIE_BASE)
    res.render('pages/auth/profile', { title: 'My Profile', user, csrfToken })
  } catch (err) {
    next(err)
  }
})

router.post('/profile', authenticateToken, async (req, res, next) => {
  try {
    const { first_name, last_name, new_password } = req.body
    await authService.updateProfile(req.user.userId, {
      firstName: first_name,
      lastName: last_name,
      newPassword: new_password,
    })
    res.cookie('flash', JSON.stringify({ type: 'success', message: 'Profile updated.' }), { ...COOKIE_BASE, maxAge: 5000 })
    res.redirect('/auth/profile')
  } catch (err) {
    if (err.status === 400) {
      res.cookie('flash', JSON.stringify({ type: 'error', message: err.message }), { ...COOKIE_BASE, maxAge: 5000 })
      return res.redirect('/auth/profile')
    }
    next(err)
  }
})

router.post('/delete-account', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return next(Object.assign(new Error('Admin accounts cannot be self-deleted.'), { status: 403, code: 'ADMIN_SELF_DELETE' }))
    }
    const formToken = req.body._csrf
    const cookieToken = req.cookies._csrf
    const formBuf = formToken ? Buffer.from(formToken) : null
    const cookieBuf = cookieToken ? Buffer.from(cookieToken) : null
    const tokensValid = formBuf && cookieBuf &&
      formBuf.length === cookieBuf.length &&
      crypto.timingSafeEqual(formBuf, cookieBuf)
    if (!tokensValid) {
      return next(Object.assign(new Error('Invalid or missing CSRF token.'), { status: 403, code: 'INVALID_CSRF' }))
    }
    await authService.deleteAccount(req.user.userId)
    res.clearCookie('token', COOKIE_BASE)
    res.clearCookie('_csrf', COOKIE_BASE)
    res.redirect('/auth/login')
  } catch (err) {
    next(err)
  }
})

// Stub dashboard routes — full content arrives in Epic 2+ stories
router.get('/student-dashboard', authenticateToken, requireRole('student'), (req, res) => {
  res.render('pages/student/dashboard', { title: 'Student Dashboard' })
})

router.get('/trainer-dashboard', authenticateToken, requireRole('trainer'), async (req, res, next) => {
  try {
    const students = await subscriptionService.listTrainerActiveStudents(req.user.userId)
    res.render('pages/trainer/dashboard', { title: 'Trainer Dashboard', students })
  } catch (err) {
    next(err)
  }
})

router.get('/admin-dashboard', authenticateToken, requireRole('admin'), async (req, res, next) => {
  try {
    const stats = await adminService.adminGetStats()
    res.render('pages/admin/dashboard', { title: 'Admin Dashboard', stats })
  } catch (err) {
    next(err)
  }
})

module.exports = router
