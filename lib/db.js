import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'finanzen.db');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    amount REAL NOT NULL CHECK(amount > 0),
    category TEXT,
    description TEXT,
    date TEXT NOT NULL,
    receipt_path TEXT,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

const DEFAULT_CATEGORIES = [
  'Lebensmittel', 'Restaurant', 'Transport', 'Wohnen', 'Gesundheit',
  'Freizeit', 'Shopping', 'Abos', 'Gehalt', 'Sonstiges',
];

const categoryCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
if (categoryCount === 0) {
  const insert = db.prepare('INSERT INTO categories (name) VALUES (?)');
  for (const name of DEFAULT_CATEGORIES) insert.run(name);
}

export function listUsers() {
  return db.prepare('SELECT id, name, created_at FROM users ORDER BY name').all();
}

export function createUser(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name erforderlich');
  const info = db.prepare('INSERT INTO users (name) VALUES (?)').run(trimmed);
  return db.prepare('SELECT id, name, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function getUser(id) {
  return db.prepare('SELECT id, name, created_at FROM users WHERE id = ?').get(id);
}

export function listTransactions(userId, { limit = 50, offset = 0, month } = {}) {
  let sql = `
    SELECT id, type, amount, category, description, date, receipt_path, source, created_at
    FROM transactions WHERE user_id = ?
  `;
  const params = [userId];
  if (month) {
    sql += ` AND strftime('%Y-%m', date) = ?`;
    params.push(month);
  }
  sql += ' ORDER BY date DESC, id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

export function createTransaction(userId, data) {
  const { type, amount, category, description, date, receipt_path, source } = data;
  const info = db.prepare(`
    INSERT INTO transactions (user_id, type, amount, category, description, date, receipt_path, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    type,
    amount,
    category || null,
    description || null,
    date,
    receipt_path || null,
    source || 'manual',
  );
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
}

export function getTransaction(userId, id) {
  return db.prepare(`
    SELECT id, type, amount, category, description, date, receipt_path, source, created_at
    FROM transactions WHERE id = ? AND user_id = ?
  `).get(id, userId);
}

export function updateTransaction(userId, id, data) {
  const existing = getTransaction(userId, id);
  if (!existing) return null;
  const { type, amount, category, description, date } = data;
  db.prepare(`
    UPDATE transactions
    SET type = ?, amount = ?, category = ?, description = ?, date = ?
    WHERE id = ? AND user_id = ?
  `).run(
    type,
    amount,
    category || null,
    description || null,
    date,
    id,
    userId,
  );
  return getTransaction(userId, id);
}

export function deleteTransaction(userId, id) {
  return db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, userId);
}

function monthlyStatsFor(yearMonth, userId = null) {
  const userClause = userId != null ? 'user_id = ? AND ' : '';
  const baseParams = userId != null ? [userId, yearMonth] : [yearMonth];

  const rows = db.prepare(`
    SELECT type, SUM(amount) as total, COUNT(*) as count
    FROM transactions
    WHERE ${userClause}strftime('%Y-%m', date) = ?
    GROUP BY type
  `).all(...baseParams);

  const income = rows.find((r) => r.type === 'income')?.total || 0;
  const expense = rows.find((r) => r.type === 'expense')?.total || 0;

  const byCategory = db.prepare(`
    SELECT category, type, SUM(amount) as total, COUNT(*) as count
    FROM transactions
    WHERE ${userClause}strftime('%Y-%m', date) = ? AND type = 'expense'
    GROUP BY category
    ORDER BY total DESC
  `).all(...baseParams);

  const daily = db.prepare(`
    SELECT date, type, SUM(amount) as total
    FROM transactions
    WHERE ${userClause}strftime('%Y-%m', date) = ?
    GROUP BY date, type
    ORDER BY date
  `).all(...baseParams);

  return { income, expense, balance: income - expense, byCategory, daily };
}

export function monthlyStats(userId, yearMonth) {
  return monthlyStatsFor(yearMonth, userId);
}

export function monthlyStatsFamily(yearMonth) {
  return monthlyStatsFor(yearMonth);
}

export function trendStats(userId, months = 6) {
  return trendStatsFor(months, userId);
}

export function trendStatsFamily(months = 6) {
  return trendStatsFor(months);
}

function trendStatsFor(months, userId = null) {
  const userClause = userId != null ? 'user_id = ? AND ' : '';
  const params = userId != null ? [userId, months] : [months];
  return db.prepare(`
    SELECT strftime('%Y-%m', date) as month, type, SUM(amount) as total
    FROM transactions
    WHERE ${userClause}date >= date('now', '-' || ? || ' months')
    GROUP BY month, type
    ORDER BY month
  `).all(...params);
}

export function getCategories() {
  return db.prepare('SELECT name FROM categories ORDER BY name COLLATE NOCASE').all().map((r) => r.name);
}

export function createCategory(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name erforderlich');
  if (trimmed.length > 40) throw new Error('Max. 40 Zeichen');
  try {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(trimmed);
    return db.prepare('SELECT id, name FROM categories WHERE id = ?').get(info.lastInsertRowid);
  } catch (e) {
    if (e.message.includes('UNIQUE')) throw new Error('Kategorie existiert bereits');
    throw e;
  }
}

export default db;
