// server.js — Minimal TRMNL BYOS server for the Office Status display.
//
// Implements the three firmware-facing endpoints every BYOS server needs
// (setup, display, log) plus one custom endpoint (/status) that the PWA
// posts updates to. Renders the display image itself with node-canvas —
// no headless browser, no Liquid template — we draw the bitmap directly.
//
// Deploy target: Google Cloud Run. State lives in Firestore (one document).

const express = require('express');
const { createCanvas } = require('canvas');
const admin = require('firebase-admin');

admin.initializeApp(); // Cloud Run supplies Application Default Credentials
const db = admin.firestore();
const STATUS_DOC = db.collection('office_status').doc('current');

const app = express();
app.set('trust proxy', true); // so req.protocol reflects Cloud Run's https, not the internal http hop
app.use(express.json({ limit: '256kb' }));

// CORS — the PWA runs on the Pi's own origin (http://192.168.1.216:8888),
// which is cross-origin from this Cloud Run service. Without these headers
// the browser silently blocks fetch() from ever reading the response, even
// though the request succeeded server-side.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

const PUSH_SECRET = process.env.PUSH_SECRET;
const REFRESH_RATE_SECONDS = parseInt(process.env.REFRESH_RATE_SECONDS || '300', 10);
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 480;

// ── Render the current status as a PNG buffer ─────────────────────
function renderStatusPng(status, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const halfW = Math.floor(width / 2);

  // Left half — big emoji, divider line down the middle
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(halfW, 0);
  ctx.lineTo(halfW, height);
  ctx.stroke();

  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(height * 0.55)}px "Noto Emoji"`;
  ctx.fillText(status.emoji || '🏢', halfW / 2, height / 2);

  // Right half — status text, expiring time, meta line
  const rightX = halfW + Math.floor(width * 0.03);
  const rightW = width - halfW - Math.floor(width * 0.06);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `bold ${Math.floor(height * 0.12)}px "DejaVu Sans"`;
  wrapText(ctx, status.statusText || 'Available', rightX, height * 0.28, rightW, height * 0.14);

  if (status.backAt) {
    ctx.font = `${Math.floor(height * 0.06)}px "DejaVu Sans"`;
    ctx.fillText(`Status expiring at ${status.backAt}`, rightX, height * 0.5);
  }

  ctx.font = `${Math.floor(height * 0.032)}px "DejaVu Sans"`;
  const updated = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  ctx.fillText(
    `Status pushed at ${status.pushedAt || '—'}, Screen updated at ${updated}`,
    rightX,
    height - Math.floor(height * 0.05)
  );

  return canvas.toBuffer('image/png');
}

// Simple word-wrap so long status text doesn't run off the panel
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  let line = '';
  let curY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = word;
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, curY);
}

// ── Auth for the PWA → server push ────────────────────────────────
function requirePushAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!PUSH_SECRET || token !== PUSH_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── PWA posts a new status here ───────────────────────────────────
app.post('/status', requirePushAuth, async (req, res) => {
  const { statusText, emoji, color, backAt, pushedAt } = req.body || {};
  await STATUS_DOC.set({
    statusText: statusText || 'Available',
    emoji: emoji || '',
    color: color || '',
    backAt: backAt || '',
    pushedAt: pushedAt || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ ok: true });
});

// ── Firmware-facing endpoints (TRMNL's BYOS contract) ─────────────
app.get('/api/setup', (req, res) => {
  res.json({
    image_url: `${baseUrl(req)}/screen.png`,
    message: 'Welcome to Office Status BYOS',
  });
});

app.get('/api/display', (req, res) => {
  const width = parseInt(req.headers['width'] || DEFAULT_WIDTH, 10);
  const height = parseInt(req.headers['height'] || DEFAULT_HEIGHT, 10);
  res.json({
    filename: `office-status-${Date.now()}.png`,
    firmware_url: null,
    firmware_version: null,
    image_url: `${baseUrl(req)}/screen.png?w=${width}&h=${height}&t=${Date.now()}`,
    image_url_timeout: 0,
    maximum_compatibility: false,
    refresh_rate: REFRESH_RATE_SECONDS,
    reset_firmware: false,
    special_function: 'none',
    temperature_profile: 'default',
    touchbar_mode: 'tap',
    update_firmware: false,
  });
});

app.post('/api/log', (req, res) => {
  console.log('[device log]', JSON.stringify(req.body));
  res.status(204).end();
});

// ── The actual rendered image, fetched by the device ──────────────
app.get('/screen.png', async (req, res) => {
  const width = parseInt(req.query.w || DEFAULT_WIDTH, 10);
  const height = parseInt(req.query.h || DEFAULT_HEIGHT, 10);

  const doc = await STATUS_DOC.get();
  const status = doc.exists ? doc.data() : { statusText: 'Available' };

  const png = renderStatusPng(status, width, height);
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-store');
  res.send(png);
});

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Office Status BYOS listening on ${PORT}`));
