import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './lib/db.js';
import * as gemini from './lib/gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';

if (!APP_PASSWORD) {
  console.error('APP_PASSWORD fehlt in .env');
  process.exit(1);
}

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Nur Bilder erlaubt'));
  },
});

const uploadAudio = multer({
  dest: uploadsDir,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Nur Audio erlaubt'));
  },
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function sign(payload) {
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data: payload, sig })).toString('base64url');
}

function verify(token) {
  try {
    const { data, sig } = JSON.parse(Buffer.from(token, 'base64url').toString());
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(JSON.stringify(data)).digest('hex');
    if (sig !== expected) return null;
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function requireAppAuth(req, res, next) {
  const token = req.cookies?.app_session;
  const session = token ? verify(token) : null;
  if (!session?.app) {
    return res.status(401).json({ error: 'Nicht angemeldet' });
  }
  req.appSession = session;
  next();
}

function requireUser(req, res, next) {
  const userId = Number(req.cookies?.user_id);
  const user = userId ? db.getUser(userId) : null;
  if (!user) {
    return res.status(401).json({ error: 'Kein Benutzer gewählt' });
  }
  req.user = user;
  next();
}

// --- Auth ---

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== APP_PASSWORD) {
    return res.status(401).json({ error: 'Falsches Passwort' });
  }
  const token = sign({ app: true, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 });
  res.cookie('app_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('app_session');
  res.clearCookie('user_id');
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  const session = req.cookies?.app_session ? verify(req.cookies.app_session) : null;
  const userId = Number(req.cookies?.user_id);
  const user = userId ? db.getUser(userId) : null;
  res.json({
    authenticated: Boolean(session?.app),
    user: user || null,
    gemini: gemini.isGeminiConfigured(),
  });
});

// --- Users ---

app.get('/api/users', requireAppAuth, (_req, res) => {
  res.json(db.listUsers());
});

app.post('/api/users', requireAppAuth, (req, res) => {
  try {
    const user = db.createUser(req.body.name);
    res.status(201).json(user);
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Name existiert bereits' : e.message });
  }
});

app.post('/api/users/select', requireAppAuth, (req, res) => {
  const user = db.getUser(Number(req.body.userId));
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  res.cookie('user_id', String(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  res.json(user);
});

// --- Transactions ---

app.get('/api/transactions', requireAppAuth, requireUser, (req, res) => {
  const { month, limit, offset } = req.query;
  res.json(db.listTransactions(req.user.id, {
    month: month || undefined,
    limit: limit ? Number(limit) : 50,
    offset: offset ? Number(offset) : 0,
  }));
});

app.post('/api/transactions', requireAppAuth, requireUser, (req, res) => {
  try {
    const { type, amount, category, description, date, source } = req.body;
    if (!['income', 'expense'].includes(type)) throw new Error('Ungültiger Typ');
    const tx = db.createTransaction(req.user.id, {
      type,
      amount: Math.abs(Number(amount)),
      category,
      description,
      date: date || new Date().toISOString().slice(0, 10),
      source: source || 'manual',
    });
    res.status(201).json(tx);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/transactions/:id', requireAppAuth, requireUser, (req, res) => {
  db.deleteTransaction(req.user.id, Number(req.params.id));
  res.json({ ok: true });
});

// --- AI ---

app.post('/api/ai/parse-text', requireAppAuth, requireUser, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Text fehlt' });
    const parsed = await gemini.parseNaturalLanguage(text.trim());
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ai/parse-audio', requireAppAuth, requireUser, uploadAudio.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Audio-Datei' });
  try {
    const parsed = await gemini.parseAudio(req.file.path, req.file.mimetype);
    fs.unlinkSync(req.file.path);
    res.json(parsed);
  } catch (e) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ai/parse-receipt', requireAppAuth, requireUser, upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Kein Bild' });
  try {
    const parsed = await gemini.parseReceiptImage(req.file.path, req.file.mimetype);
    const ext = path.extname(req.file.originalname) || '.jpg';
    const dest = path.join(uploadsDir, `${req.user.id}-${Date.now()}${ext}`);
    fs.renameSync(req.file.path, dest);
    res.json({ ...parsed, receipt_path: `/uploads/${path.basename(dest)}` });
  } catch (e) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

app.use('/uploads', requireAppAuth, express.static(uploadsDir));

// --- Stats ---

app.get('/api/stats/monthly', requireAppAuth, requireUser, (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  res.json(db.monthlyStats(req.user.id, month));
});

app.get('/api/stats/trends', requireAppAuth, requireUser, (req, res) => {
  const months = Number(req.query.months) || 6;
  res.json(db.trendStats(req.user.id, months));
});

app.get('/api/categories', requireAppAuth, (_req, res) => {
  res.json(db.getCategories());
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Finanzen-Tracker läuft auf http://localhost:${PORT}`);
});
