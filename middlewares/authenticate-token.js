const jwt = require('jsonwebtoken')

module.exports = function authenticateToken(req, res, next) {
  const token = req.cookies.token
  if (!token) return res.redirect('/auth/login')
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = { userId: payload.userId, role: payload.role }
    next()
  } catch {
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' })
    return res.redirect('/auth/login')
  }
}
