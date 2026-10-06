const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// ── Load .env manually (no dependency on dotenv/dotenvx packages) ──
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  });
  console.log('✅ .env loaded');
} else {
  console.log('⚠️  No .env file found in', __dirname, '(fine on Render — env vars come from the dashboard instead)');
}

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const IS_PROD = process.env.NODE_ENV === 'production';

// Serving the frontend is OPTIONAL. This backend works perfectly well as a
// standalone API with the frontend hosted somewhere else entirely (a
// separate Render Static Site, Netlify, Vercel, anywhere) — in that setup
// there's no frontend/ folder next to server.js at all, and that's fine.
// If the folder IS present (the single-service layout from earlier), it
// gets served automatically; if not, this just logs that it's running in
// API-only mode instead of failing.
const FRONTEND_CANDIDATES = [
  path.join(__dirname, '..', 'frontend'),
  path.join(__dirname, 'frontend'),
  path.join(__dirname, '..', '..', 'frontend')
];
const FRONTEND_DIR = FRONTEND_CANDIDATES.find((p) => fs.existsSync(path.join(p, 'index.html')));

if (FRONTEND_DIR) {
  console.log('✅ Also serving frontend from', FRONTEND_DIR);
} else {
  console.log('ℹ️  No frontend folder found — running as an API-only backend.');
  console.log('   If the frontend is hosted separately, make sure that frontend\'s');
  console.log('   config.js points API_BASE_URL at this service\'s URL, and set');
  console.log('   CORS_ORIGIN below to that frontend\'s exact URL.');
}

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set. Set it in .env locally, or in your host\'s');
  console.error('   environment variables (e.g. Render → Environment) with:');
  console.error('   MONGO_URI=your-mongodb-atlas-connection-string');
  process.exit(1);
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET is missing or too short. Set a random value at least 32');
  console.error('   characters long, e.g.:');
  console.error('   JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'));
  process.exit(1);
}

// Render (and most hosts) put the app behind a reverse proxy. Without this,
// Express sees every request as coming from the proxy's internal IP, which
// breaks both "real" IP logging and the rate limiters below.
app.set('trust proxy', 1);

// Security headers. CSP is left off because this app is a single self-hosted
// HTML file with inline <script>/<style> and no external script hosts other
// than Google Fonts — a default CSP would block it outright. Every other
// helmet protection (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
// still applies.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS: by default this only allows the page's own origin (the common case —
// the backend serves the frontend itself, so no cross-origin calls happen at
// all). If you host the frontend separately, set CORS_ORIGIN to its exact
// URL(s) — comma-separated for more than one. Only set it to '*' for local
// testing; never on a deployment that handles real accounts.
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : true,
  credentials: false
}));

app.use(express.json({ limit: '1mb' })); // raised for profile photo uploads (base64)
if (FRONTEND_DIR) app.use(express.static(FRONTEND_DIR));

// General API rate limit — generous, just a backstop against runaway loops
// or scripted abuse, not meant to bother normal use.
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false
}));

// Tighter limit on login/register specifically, since those are what a
// password-guessing or mass-signup script would actually hit.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please wait a few minutes and try again.' }
});

// Unauthenticated connectivity check — confirms the server is up and
// whether it currently has a MongoDB connection, independent of login.
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      mongo: mongoose.connection.readyState === 1 ? 'connected' : 'not connected',
      time: new Date().toISOString()
    }
  });
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/team', require('./routes/team'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/admin', require('./routes/admin'));

app.get('/', (req, res) => {
  if (FRONTEND_DIR) return res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  res.json({ success: true, data: { message: 'TaskFlow API is running.', health: '/api/health' } });
});

// Catch-all error handler so failures show as JSON, not silent crashes. In
// production the raw error message is logged but not sent to the client —
// internal error text (stack traces, DB details) is exactly the kind of
// thing that shouldn't leak to whoever happens to trigger a 500.
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: IS_PROD ? 'Something went wrong. Please try again.' : err.message });
});

mongoose.connection.on('error', (err) => {
  console.error('⚠️  MongoDB connection error after startup:', err.message);
});
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected — the app will return errors until it reconnects.');
});

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 15000, family: 4 })
  .then(() => {
    console.log('✅ Connected to MongoDB Atlas');
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    if (err.reason) console.error('   Reason:', err.reason.toString());
    console.error('   Common causes: wrong password in MONGO_URI, or your current IP is not');
    console.error('   whitelisted in Atlas → Network Access → Add IP Address (on Render, that');
    console.error('   means allowing 0.0.0.0/0 since Render\'s outbound IPs vary).');
    process.exit(1);
  });
