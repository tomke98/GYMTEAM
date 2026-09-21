const multer = require('multer')
const path = require('path')
const crypto = require('crypto')

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`)
  }
})

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase()
  cb(null, ALLOWED_EXTENSIONS.has(ext))
}

const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE }, fileFilter })

module.exports = upload
