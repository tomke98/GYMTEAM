const express = require('express')
const helmet = require('helmet')
const morgan = require('morgan')
const cookieParser = require('cookie-parser')
const jwt = require('jsonwebtoken')
const errorHandler = require('./middlewares/error-handler')

const app = express()

app.set('view engine', 'ejs')
app.set('views', './views')

app.use(helmet())
app.use(morgan('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
app.use(express.static('public'))

// Best-effort user resolver — sets res.locals.user for all EJS templates
// Never throws; authenticateToken middleware enforces auth on protected routes
app.use((req, res, next) => {
  try {
    const token = req.cookies.token
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET)
      res.locals.user = { userId: payload.userId, role: payload.role }
    } else {
      res.locals.user = null
    }
  } catch {
    res.locals.user = null
  }
  next()
})

// Flash cookie-read middleware — must come before routes
app.use((req, res, next) => {
  const raw = req.cookies.flash
  if (raw) {
    try { res.locals.flash = JSON.parse(raw) } catch { res.locals.flash = null }
    res.clearCookie('flash', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' })
  } else {
    res.locals.flash = null
  }
  next()
})

// Route stubs — uncommented as each story is implemented
app.use('/auth', require('./routes/auth'))
app.use('/trainers', require('./routes/trainers'))
app.use('/gyms', require('./routes/gyms'))
app.use('/subscriptions', require('./routes/subscriptions'))
app.use('/trainers', require('./routes/schedules'))
app.use('/gym-subscriptions', require('./routes/gym-subscriptions'))
app.use('/bookings', require('./routes/bookings'))
app.use('/waitlist', require('./routes/waitlist'))
app.use('/reviews', require('./routes/reviews'))
app.use('/admin', require('./routes/admin'))

// 404 catch-all — must come after all routes, before error handler
app.use((req, res, next) => {
  const err = new Error('Not Found')
  err.status = 404
  err.code = 'NOT_FOUND'
  next(err)
})

app.use(errorHandler)



module.exports = app
