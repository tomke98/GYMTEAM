const VALID_ROLES = new Set(['student', 'trainer', 'admin'])

module.exports = function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      const role = req.user && VALID_ROLES.has(req.user.role) ? req.user.role : null
      const dest = role ? `/auth/${role}-dashboard` : '/auth/login'
      return res.redirect(dest)
    }
    next()
  }
}
