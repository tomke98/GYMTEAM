module.exports = function errorHandler(err, req, res, next) {
  const status = err.status || 500
  const code = err.code || 'INTERNAL_ERROR'
  const message = status < 500 ? (err.message || 'An unexpected error occurred.') : 'An unexpected error occurred.'
  if (status >= 500) console.error(err)
  res.status(status).json({ error: { code, message, status } })
}
