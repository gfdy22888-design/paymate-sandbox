// store.js — order persistence + state machine, node:sqlite (experimental in Node 22, works)
// Session ownership: each browser session gets a session_id cookie; orders are scoped to it.
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.PAYMATE_DB || path.join(__dirname, '..', 'data', 'paymate.db');
require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','confirmed','created','approved','captured','cancelled')),
  total_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  client_total_cents INTEGER,          -- what client claimed (stored for tamper test evidence; NEVER trusted)
  paypal_order_id TEXT,
  idempotency_key TEXT UNIQUE,
  capture_result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  rationale TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  event TEXT NOT NULL
);
`);

const TRANSITIONS = {
  draft:     ['confirmed', 'cancelled'],
  confirmed: ['created', 'cancelled'],
  created:   ['approved', 'cancelled'],
  approved:  ['captured', 'cancelled'],
  captured:  [],           // terminal
  cancelled: [],           // terminal
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function logEvent(orderId, event) {
  db.prepare('INSERT INTO events (order_id, ts, event) VALUES (?,?,?)')
    .run(orderId, new Date().toISOString(), event);
}

function createOrder({ sessionId, items, totalCents, clientTotalCents }) {
  const id = 'PM-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const now = new Date().toISOString();
  // transactional: order + items commit atomically
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO orders (id, session_id, status, total_cents, currency, client_total_cents, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, sessionId, 'draft', totalCents, 'USD', clientTotalCents ?? null, now, now);
    const ins = db.prepare('INSERT INTO items (order_id, sku, qty, unit_price_cents, rationale) VALUES (?,?,?,?,?)');
    for (const it of items) ins.run(id, it.sku, it.qty, it.unit_price_cents, it.rationale || null);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
  logEvent(id, `created as draft (server_total=${totalCents}, client_claimed=${clientTotalCents ?? 'n/a'})`);
  return id;
}

// Only the owning session may read/act on an order.
function getOrder(id, sessionId) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND session_id = ?').get(id, sessionId);
  if (!o) return null;
  o.items = db.prepare('SELECT sku, qty, unit_price_cents, rationale FROM items WHERE order_id = ?').all(id);
  return o;
}

function transition(id, sessionId, to, extra = {}) {
  const o = getOrder(id, sessionId);
  if (!o) return { ok: false, code: 404, error: 'ORDER_NOT_FOUND_OR_NOT_YOURS' };
  if (o.status === to) {
    // idempotent re-read for capture: return existing result
    return { ok: true, idempotent: true, order: o };
  }
  if (!canTransition(o.status, to)) {
    return { ok: false, code: 409, error: `ILLEGAL_TRANSITION: ${o.status} -> ${to}` };
  }
  const now = new Date().toISOString();
  const sets = ['status = ?', 'updated_at = ?'];
  const vals = [to, now];
  if (extra.paypal_order_id !== undefined) { sets.push('paypal_order_id = ?'); vals.push(extra.paypal_order_id); }
  if (extra.idempotency_key !== undefined) { sets.push('idempotency_key = ?'); vals.push(extra.idempotency_key); }
  if (extra.capture_result_json !== undefined) { sets.push('capture_result_json = ?'); vals.push(extra.capture_result_json); }
  vals.push(id, sessionId);
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND session_id = ?`).run(...vals);
  logEvent(id, `transition ${o.status} -> ${to}${extra.note ? ' (' + extra.note + ')' : ''}`);
  return { ok: true, order: getOrder(id, sessionId) };
}

function listEvents(id, sessionId) {
  const o = getOrder(id, sessionId);
  if (!o) return null;
  return db.prepare('SELECT ts, event FROM events WHERE order_id = ? ORDER BY id').all(id);
}

module.exports = { createOrder, getOrder, transition, listEvents, canTransition, TRANSITIONS };
