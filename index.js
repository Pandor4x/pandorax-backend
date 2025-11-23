const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Serve frontend static files (embedded in backend repo)
const frontendDir = path.join(__dirname, 'recipe_frontend'); // embedded
// Diagnostic: log the resolved frontend path and whether it exists (helpful on Render)
try {
  const frontendExists = fs.existsSync(frontendDir);
  console.log('Resolved frontendDir =', frontendDir, 'exists =', frontendExists);
  if (frontendExists) {
    try {
      const files = fs.readdirSync(frontendDir);
      console.log('Frontend files count =', files.length);
    } catch (e) {
      console.warn('Failed to read frontendDir contents:', e && e.message);
    }
  } else {
    console.warn('Frontend directory not found — static files will not be served.');
  }
} catch (e) {
  console.warn('Error checking frontendDir:', e && e.message);
}
app.use(express.static(frontendDir));

// Simple request logger to trace incoming requests (helps debug 500s)
app.use((req, res, next) => {
  console.log('REQ ->', req.method, req.path);
  next();
});

// Uploads folder
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Import DB pool for startup connectivity test (logs helpful on deploy)
const pool = require('./models/db');

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, Date.now() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Routes
const { verifyAdmin } = require('./middleware/authMiddleware');
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const recipeRoutes = require('./routes/recipeRoutes');
const contactRoutes = require('./routes/contactRoutes');
const favoriteRoutes = require('./routes/favoriteRoutes');

app.post('/api/upload', verifyAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.filename });
});

app.use('/api/users', userRoutes);
app.use('/api/recipes', recipeRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/favorites', favoriteRoutes);

// Health/readiness endpoint (placed before SPA fallback so it isn't shadowed)
app.get('/health', (req, res) => {
  const frontendExists = !!(frontendDir && fs.existsSync(frontendDir));
  res.json({
    status: 'ok',
    pid: process.pid,
    uptime: process.uptime(),
    frontendDir: frontendDir,
    frontendExists: frontendExists
  });
});

// 🔥 FIX: SPA fallback so frontend routes work
// Use middleware instead of a route pattern to avoid path-to-regexp errors
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  // don't interfere with API or uploads or asset requests
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  // if the request is for a file with an extension (e.g., .js, .css, images), skip
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Error handler for large payloads
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Payload too large' });
  }
  next(err);
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Startup DB connectivity test — logs detailed errors to help diagnose "Connection terminated unexpectedly"
setTimeout(async () => {
  const attempts = 6;
  const baseDelay = 500; // ms
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log('DB: testing connectivity with SELECT 1 (attempt', attempt, ')');
      const r = await pool.query('SELECT 1');
      console.log('DB: connectivity test OK', r && r.rowCount);
      break;
    } catch (err) {
      const msg = err && (err.stack || err.message || err);
      // If the pool proxy isn't ready yet, wait and retry
      console.warn(`DB connectivity attempt ${attempt} failed:`, msg);
      if (attempt === attempts) {
        console.error('DB connectivity test failed after retries:', msg);
        break;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise((res) => setTimeout(res, delay));
      continue;
    }
  }
}, 1000);
