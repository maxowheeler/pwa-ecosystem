// server.js — BYOS server for Office Status.
//
// Renders the display image server-side (node-canvas, no headless browser),
// reads current status from Firestore, and pulls today's Outlook events from
// a published .ics feed URL. Implements TRMNL's firmware API contract:
// /api/setup, /api/display, /api/log, plus a custom /status endpoint the
// PWA posts to.
//
// ── Required Cloud Run environment variables ──────────────────────
//   PUSH_SECRET       — Bearer token the PWA authenticates /status pushes with
//   OUTLOOK_ICS_URL    — published-calendar .ics feed URL (treat like a password)
//   DISPLAY_TIMEZONE   — IANA tz name, e.g. America/Chicago (defaults to that if unset)
// ── Optional ───────────────────────────────────────────────────────
//   REFRESH_RATE_SECONDS        — daytime, weekday refresh cadence (default 300)
//   NIGHT_REFRESH_RATE_SECONDS  — overnight AND weekend refresh cadence (default 3600)
//   NIGHT_START_HOUR / NIGHT_END_HOUR — night window bounds (default 18 / 6)
//
// These are NOT baked into the Dockerfile (secrets don't belong in the image) —
// set them under the Cloud Run service's "Variables & Secrets" tab. If
// OUTLOOK_ICS_URL is missing, the display will now say so explicitly instead
// of silently showing "No current event" as if the calendar were just empty.

const express = require('express');
const { createCanvas, loadImage } = require('canvas');
const admin = require('firebase-admin');
const zlib = require('zlib');
const ical = require('node-ical');
const path = require('path');
const fs = require('fs');

admin.initializeApp(); // Cloud Run supplies Application Default Credentials
const db = admin.firestore();
const STATUS_DOC = db.collection('office_status').doc('current');

const app = express();
app.set('trust proxy', true); // so req.protocol reflects Cloud Run's https, not the internal http hop
app.use(express.json({ limit: '256kb' })); // plenty of headroom for a small base64 256x256 pushed icon

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
const NIGHT_REFRESH_RATE_SECONDS = parseInt(process.env.NIGHT_REFRESH_RATE_SECONDS || '3600', 10);
const NIGHT_START_HOUR = parseInt(process.env.NIGHT_START_HOUR || '18', 10); // 6 PM
const NIGHT_END_HOUR = parseInt(process.env.NIGHT_END_HOUR || '6', 10);       // 6 AM
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 480;
const NOMINAL_WIDTH = 800; // the resolution this whole layout was designed against — scales from here
// Cloud Run's runtime clock defaults to UTC with no awareness of where you
// actually are — without this, all local-time display drifted hours off.
const DISPLAY_TIMEZONE = process.env.DISPLAY_TIMEZONE || 'America/Chicago';
// Outlook's published-calendar .ics URL. Treat this like a password — the
// GUIDs in it ARE the access control, there's no separate auth layer.
const OUTLOOK_ICS_URL = process.env.OUTLOOK_ICS_URL || '';
const ASSETS_DIR = path.join(__dirname, 'assets');

// Startup warning — surfaces a missing env var in Cloud Run logs immediately
// rather than only being discoverable by staring at the rendered display.
if (!OUTLOOK_ICS_URL) {
  console.warn('[startup] OUTLOOK_ICS_URL is not set — Outlook section will show as unconfigured, not "no events".');
}

// ── Refresh cadence — faster on weekdays/daytime, slower otherwise ─
// "Slower otherwise" now covers both overnight AND weekends — reuses the
// same NIGHT_REFRESH_RATE_SECONDS value for both rather than introducing
// a second env var, so no Cloud Run config change is needed for this.
function isNightWindow() {
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: DISPLAY_TIMEZONE }).format(new Date()),
    10
  );
  return NIGHT_START_HOUR > NIGHT_END_HOUR
    ? (hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR) // window wraps past midnight
    : (hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR);
}

function isWeekend() {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: DISPLAY_TIMEZONE }).format(new Date());
  return weekday === 'Sat' || weekday === 'Sun';
}

function currentRefreshRate() {
  return (isWeekend() || isNightWindow()) ? NIGHT_REFRESH_RATE_SECONDS : REFRESH_RATE_SECONDS;
}

function refreshCadenceLabel() {
  const minutes = Math.round(currentRefreshRate() / 60);
  return `updates every ~${minutes} minute${minutes === 1 ? '' : 's'}`;
}

// ── Battery telemetry — sent by TRMNL firmware as request headers ──
// Captured on every /api/display poll and cached in memory for the
// /screen.png render that follows shortly after. Cloud Run cold starts
// will reset this to null until the next poll — acceptable, since it
// just means the indicator is briefly blank rather than wrong.
//
// NOTE: exact header names/casing are unconfirmed against your specific
// firmware build — this checks several plausible variants. After your
// first deploy, check Cloud Run logs for the "[battery] headers snapshot"
// line to confirm which key your device actually sends, then this can
// be trimmed down to just that one and the debug log removed.
let lastBattery = { percent: null, updatedAt: null };

function captureBatteryHeaders(req) {
  const h = req.headers;

  // TEMPORARY DEBUG AID — remove once the real header name is confirmed.
  console.log('[battery] headers snapshot', JSON.stringify({
    percent_charged: h['percent_charged'],
    'percent-charged': h['percent-charged'],
    battery_percent: h['battery_percent'],
    'battery-percent': h['battery-percent'],
    battery_voltage: h['battery_voltage'],
    'battery-voltage': h['battery-voltage'],
  }));

  const percentRaw = h['percent_charged'] ?? h['percent-charged'] ?? h['battery_percent'] ?? h['battery-percent'];
  const voltageRaw = h['battery_voltage'] ?? h['battery-voltage'];

  let percent = null;
  if (percentRaw !== undefined) {
    const p = parseFloat(percentRaw);
    if (Number.isFinite(p)) percent = Math.round(p);
  } else if (voltageRaw !== undefined) {
    // Rough LiPo voltage→percent curve — fallback only, used if the
    // firmware sends raw voltage instead of a precomputed percentage.
    const v = parseFloat(voltageRaw);
    if (Number.isFinite(v)) {
      percent = Math.round(Math.max(0, Math.min(100, ((v - 3.3) / (4.2 - 3.3)) * 100)));
    }
  }

  if (percent !== null) {
    lastBattery = { percent, updatedAt: Date.now() };
  }
}

// ── Minimal 1-bit PNG encoder ──────────────────────────────────────
// node-canvas only writes 32-bit RGBA PNGs. At 800x480 that's ~1.5MB to
// decode — far more than an e-ink device's free heap (often under 200KB).
// A true 1-bit black/white PNG is ~48KB, which is what these devices
// actually expect. Built on Node's built-in zlib, no extra dependency.

function crc32(buf) {
  const table = crc32._table || (crc32._table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// whitePixels: Uint8Array, length width*height, 1 = white, 0 = black
function encode1BitPng(whitePixels, width, height) {
  const rowBytes = Math.ceil(width / 8);
  const raw = Buffer.alloc((rowBytes + 1) * height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      if (whitePixels[y * width + x]) {
        raw[rowStart + 1 + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }

  const idatData = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1;  // bit depth
  ihdr[9] = 0;  // color type: grayscale
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Art assets — fixed image per canned status, or a small image ───
// pushed directly from the PWA (takes precedence when present).
// Preset icons are bundled straight into the container under
// /assets/<icon>.png. Falls back to a labeled placeholder box if
// neither is available, so the pipeline still works end to end.
const artImageCache = new Map();

async function loadArtImage(iconKey) {
  const key = iconKey || 'default';
  if (artImageCache.has(key)) return artImageCache.get(key);

  const filePath = path.join(ASSETS_DIR, `${key}.png`);
  let img = null;
  if (fs.existsSync(filePath)) {
    try {
      img = await loadImage(filePath);
    } catch (e) {
      console.error('[art] failed to load', filePath, e.message);
    }
  }
  artImageCache.set(key, img); // cache the miss too — a new deploy gets a fresh cache anyway
  return img;
}

// Pushed images arrive as base64 in Firestore, not a filename — never
// cached, since a new one could be pushed at any time and it's cheap to
// decode compared to a filesystem read.
async function loadArtImageForStatus(status) {
  if (status.iconImage) {
    try {
      return await loadImage(Buffer.from(status.iconImage, 'base64'));
    } catch (e) {
      console.error('[art] failed to decode pushed iconImage', e.message);
    }
  }
  return loadArtImage(status.icon);
}

// Fits `img` inside a `size`×`size` box at (x, y) without distorting its
// aspect ratio — the long side is scaled to `size`, the short side is
// scaled proportionally and centered, leaving even white padding on
// whichever axis is shorter. Replaces a plain drawImage(img, x, y, size,
// size), which stretched non-square source art.
function drawImageContained(ctx, img, x, y, size) {
  const scale = Math.min(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const dx = x + (size - w) / 2;
  const dy = y + (size - h) / 2;
  ctx.drawImage(img, dx, dy, w, h);
}

function drawArtPlaceholder(ctx, key, x, y, size) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(size * 0.11)}px "DejaVu Sans"`;
  ctx.fillText(`[${key}]`, x + size / 2, y + size / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// Small procedurally-drawn battery glyph — deliberately NOT a font
// glyph/emoji. Font-rendered characters have been the recurring
// breakage point in this project (see the Dockerfile font package
// mixup); plain canvas primitives can't have that problem.
function drawBatteryIcon(ctx, percent, x, y, w, h, nubW) {
  const pad = Math.max(1, Math.round(h * 0.15));

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = '#000000';
  ctx.fillRect(x + w, y + h * 0.25, nubW, h * 0.5);

  const pct = Math.max(0, Math.min(100, percent ?? 0));
  const fillW = Math.round((w - pad * 2) * (pct / 100));
  if (fillW > 0) {
    ctx.fillRect(x + pad, y + pad, fillW, h - pad * 2);
  }
}

// ── Outlook calendar — via published .ics feed, not OAuth ─────────
// Deliberately not Microsoft Graph: this reads the same published-calendar
// feed URL that's already syncing into Google Calendar today. No Azure app
// registration, no admin consent, nothing touching the work tenant directly.
function localDateString(date) {
  // en-CA formats as YYYY-MM-DD directly — used purely so two dates can be
  // compared by string equality without fiddly timezone-boundary math.
  return new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatEventTime(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: DISPLAY_TIMEZONE });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Outlook feed timed out')), ms)),
  ]);
}

// Known-honest limitation: recurring-event expansion here is a first pass —
// heavily modified recurring series or all-day events may need iteration
// once tested against your real calendar.
async function getTodayEvents() {
  // Distinguish "not configured" from "fetched fine, nothing today" — these
  // used to look identical on the display ("No current event" either way),
  // which is exactly what masked the missing OUTLOOK_ICS_URL env var.
  if (!OUTLOOK_ICS_URL) {
    return { current: null, next: null, error: 'not_configured' };
  }

  try {
    const data = await withTimeout(ical.async.fromURL(OUTLOOK_ICS_URL), 8000);
    const now = new Date();
    const today = localDateString(now);
    const occurrences = [];

    for (const key in data) {
      const ev = data[key];
      if (ev.type !== 'VEVENT') continue;

      if (ev.rrule) {
        const rangeStart = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        const rangeEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
        const duration = ev.end.getTime() - ev.start.getTime();
        const dates = ev.rrule.between(rangeStart, rangeEnd, true);
        for (const occStart of dates) {
          occurrences.push({ start: occStart, end: new Date(occStart.getTime() + duration), summary: ev.summary });
        }
      } else if (ev.start && ev.end) {
        occurrences.push({ start: ev.start, end: ev.end, summary: ev.summary });
      }
    }

    const todays = occurrences.filter(o => localDateString(o.start) === today);
    todays.sort((a, b) => a.start - b.start);

    const current = todays.find(o => o.start <= now && now <= o.end) || null;
    const next = todays.find(o => o.start > now) || null;

    return { current, next, error: null };
  } catch (e) {
    console.error('[outlook] fetch/parse failed', e.message);
    return { current: null, next: null, error: e.message };
  }
}

// ── Render the current status as a PNG buffer ─────────────────────
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
  return curY;
}

// True when the pushed status has a backAtISO timestamp in the past.
// Statuses with no backAt at all (e.g. plain "Available") are never expired.
function isStatusExpired(status) {
  if (!status.backAtISO) return false;
  const t = new Date(status.backAtISO).getTime();
  return Number.isFinite(t) && t < Date.now();
}

async function renderStatusPng(status, calendar, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false; // preserve crisp pixel/dithered art, no blur on scale

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';

  const scale = width / NOMINAL_WIDTH;
  const margin = Math.round(24 * scale);
  const artSize = Math.round(256 * scale);

  // Outlook-as-fallback-status: when the pushed status is still the
  // literal default "Available" AND there's a current Outlook event,
  // show that event as the headline instead. Whenever a real status is
  // set, or there's no current event, the normal layout below takes
  // precedence unchanged. This is a first-draft layout, not a finished
  // spec — easy to redirect once you've seen it rendered.
  const usingOutlookFallback = (status.statusText || 'Available') === 'Available' && !!calendar.current;

  // ── Battery indicator — reserve corner space before title wraps ──
  ctx.font = `${Math.floor(height * 0.032)}px "DejaVu Sans"`;
  let batteryReserved = 0;
  let battW = 0, battH = 0, nubW = 0, battGap = 0, battLabel = '';
  if (lastBattery.percent !== null) {
    battW   = Math.round(36 * scale);
    battH   = Math.round(16 * scale);
    nubW    = Math.round(4 * scale);
    battGap = Math.round(6 * scale);
    battLabel = `${lastBattery.percent}%`;
    const labelW = ctx.measureText(battLabel).width;
    batteryReserved = battW + nubW + battGap + labelW + battGap;
  }

  // ── Art board ─────────────────────────────────────────────────
  const artImg = await loadArtImageForStatus(status);
  if (artImg) {
    drawImageContained(ctx, artImg, margin, margin, artSize);
  } else {
    drawArtPlaceholder(ctx, status.icon || 'default', margin, margin, artSize);
  }

  // ── Title ─────────────────────────────────────────────────────
  const textX = margin + artSize + margin;
  const textW = width - textX - margin - batteryReserved;
  const displayTitle = usingOutlookFallback
    ? `Outlook: ${calendar.current.summary}`
    : (status.statusText || 'Available');
  ctx.font = `bold ${Math.floor(height * 0.12)}px "DejaVu Sans"`;
  wrapText(ctx, displayTitle, textX, margin + height * 0.09, textW, height * 0.13);

  // ── Second row beneath the title ────────────────────────────────
  // Manual-push mode: "Status expiring/expired at X" + "Status pushed at Y",
  // inverted to black-on-white once actually expired.
  // Outlook-fallback mode: just the event's end time, same visual slot.
  const colY = margin + artSize * 0.72;
  const rowFontSize = height * 0.042;
  const rowLineHeight = height * 0.06;

  if (!usingOutlookFallback) {
    const expired = isStatusExpired(status);
    // Box height tied to the actual font/line-height used below, instead
    // of a rough margin fraction — sized for up to 2 wrapped lines, no more.
    const rowTop    = colY - rowFontSize * 0.78;
    const rowBottom = colY + rowLineHeight + rowFontSize * 0.32;

    if (expired) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(textX - margin * 0.3, rowTop, textW + margin * 0.3, rowBottom - rowTop);
      ctx.fillStyle = '#ffffff';
    }

    ctx.font = `${Math.floor(rowFontSize)}px "DejaVu Sans"`;
    if (status.backAt) {
      const label = expired ? `Status expired at ${status.backAt}` : `Status expiring at ${status.backAt}`;
      wrapText(ctx, label, textX, colY, textW * 0.5, rowLineHeight);
    }
    wrapText(ctx, `Status pushed at ${status.pushedAt || '—'}`, textX + textW * 0.52, colY, textW * 0.46, rowLineHeight);

    ctx.fillStyle = '#000000'; // restore for everything below
  } else {
    ctx.font = `${Math.floor(rowFontSize)}px "DejaVu Sans"`;
    wrapText(ctx, `Until ${formatEventTime(calendar.current.end)}`, textX, colY, textW, rowLineHeight);
  }

  // ── Battery indicator — drawn last so it sits on top of everything ─
  if (lastBattery.percent !== null) {
    const battY = margin;
    // measureText needs the right font active — restore it, since title/
    // row drawing above changed ctx.font in between.
    ctx.font = `${Math.floor(height * 0.032)}px "DejaVu Sans"`;
    const labelW = ctx.measureText(battLabel).width;
    const battX = width - margin - nubW - battW - battGap - labelW;

    drawBatteryIcon(ctx, lastBattery.percent, battX, battY, battW, battH, nubW);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#000000';
    ctx.fillText(battLabel, battX + battW + nubW + battGap, battY + battH - Math.round(battH * 0.22));
  }

  // ── Divider ───────────────────────────────────────────────────
  const dividerY1 = margin + artSize + margin * 0.8;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(margin, dividerY1);
  ctx.lineTo(width - margin, dividerY1);
  ctx.stroke();

  // ── Outlook section ──────────────────────────────────────────
  ctx.font = `${Math.floor(height * 0.03)}px "DejaVu Sans"`;
  ctx.fillText('Outlook Calendar', margin, dividerY1 + height * 0.045);

  const outlookY = dividerY1 + height * 0.09;
  const outlookColW = (width - margin * 3) / 2;
  const outlookNextX = margin * 2 + outlookColW;
  ctx.font = `${Math.floor(height * 0.042)}px "DejaVu Sans"`;

  if (calendar.error === 'not_configured') {
    ctx.fillText('Outlook: not configured (missing OUTLOOK_ICS_URL)', margin, outlookY);
  } else if (calendar.error) {
    ctx.fillText("Outlook: couldn't load calendar", margin, outlookY);
  } else {
    // In fallback mode the current event is already the headline above —
    // repeating it here would be redundant, so this column is left blank
    // in that case (first-draft choice; happy to fill it with something
    // else once you've seen it).
    if (!usingOutlookFallback) {
      if (calendar.current) {
        const y1 = wrapText(ctx, `Current event: ${calendar.current.summary}`, margin, outlookY, outlookColW, height * 0.05);
        wrapText(ctx, `until ${formatEventTime(calendar.current.end)}`, margin, y1 + height * 0.05, outlookColW, height * 0.05);
      } else {
        ctx.fillText('No current event', margin, outlookY);
      }
    }

    if (calendar.next) {
      const y2 = wrapText(ctx, `Up next: ${calendar.next.summary}`, outlookNextX, outlookY, outlookColW, height * 0.05);
      wrapText(ctx, `${formatEventTime(calendar.next.start)}\u2013${formatEventTime(calendar.next.end)}`, outlookNextX, y2 + height * 0.05, outlookColW, height * 0.05);
    }
  }

  // ── Bottom divider ───────────────────────────────────────────
  const dividerY2 = height - height * 0.15;
  ctx.beginPath();
  ctx.moveTo(margin, dividerY2);
  ctx.lineTo(width - margin, dividerY2);
  ctx.stroke();

  // ── Footer — two columns ─────────────────────────────────────
  const footerY = height - height * 0.06;
  ctx.font = `${Math.floor(height * 0.028)}px "DejaVu Sans"`;

  const updatedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: DISPLAY_TIMEZONE,
  });
  const updatedTime = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: DISPLAY_TIMEZONE,
  });
  ctx.textAlign = 'left';
  ctx.fillText(`Screen updated at ${updatedTime}, ${updatedDate}`, margin, footerY);

  ctx.textAlign = 'right';
  ctx.fillText(`Screen ${refreshCadenceLabel()}`, width - margin, footerY);
  ctx.textAlign = 'left';

  // ── Threshold to true 1-bit black/white, then encode ────────────
  const { data } = ctx.getImageData(0, 0, width, height);
  const whitePixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const luminance = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
    whitePixels[i] = luminance >= 128 ? 1 : 0;
  }

  return encode1BitPng(whitePixels, width, height);
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
  const { statusText, backAt, backAtISO, pushedAt, icon, iconImage } = req.body || {};
  await STATUS_DOC.set({
    statusText: statusText || 'Available',
    icon:       icon || '',
    // Small base64 PNG pushed directly from the PWA — takes precedence
    // over `icon` at render time. Nothing sends this yet (PWA-side image
    // picker is still on the backlog); the endpoint just already accepts
    // it so that piece can land independently later.
    iconImage:  iconImage || null,
    backAt:     backAt || '',
    backAtISO:  backAtISO || null, // needed to know when a status has actually expired
    pushedAt:   pushedAt || '',
    updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
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
  captureBatteryHeaders(req);

  const width = parseInt(req.headers['width'] || DEFAULT_WIDTH, 10);
  const height = parseInt(req.headers['height'] || DEFAULT_HEIGHT, 10);
  res.json({
    filename: `office-status-${Date.now()}.png`,
    firmware_url: null,
    firmware_version: null,
    image_url: `${baseUrl(req)}/screen.png?w=${width}&h=${height}&t=${Date.now()}`,
    image_url_timeout: 0,
    maximum_compatibility: false,
    refresh_rate: currentRefreshRate(),
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
  const calendar = await getTodayEvents();

  const png = await renderStatusPng(status, calendar, width, height);
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-store');
  res.send(png);
});

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Office Status BYOS listening on ${PORT}`));
