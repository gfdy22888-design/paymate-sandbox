// test/e2e.test.js — HTTP full-chain smoke + all required negative/idempotency/ownership tests.
// Run: node test/e2e.test.js   (starts its own server instance on a random free port)
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 18899 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; results.push(`PASS  ${name}`); }
  else { failed++; results.push(`FAIL  ${name} ${detail}`); }
}

function req(method, p, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(`${BASE}${p}`, {
      method,
      headers: {
        Host: `127.0.0.1:${PORT}`,
        ...(method === 'POST' ? { Origin: `http://127.0.0.1:${PORT}` } : {}),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, json, text: b, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { await req('GET', '/api/catalog'); return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server not ready');
}

(async () => {
  // fresh DB for test run
  const dbFile = path.join(ROOT, 'data', `test-${Date.now()}.db`);
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PAYMATE_PORT: String(PORT), PAYMATE_DB: dbFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', d => process.env.VERBOSE && console.error('[srv]', d.toString()));

  try {
    await waitReady();

    // ===== catalog =====
    const cat = await req('GET', '/api/catalog');
    check('catalog returns 7 SKUs', cat.json.catalog.length === 7);

    // ===== intent parsing =====
    let r = await req('POST', '/api/intent', { body: { text: '我要 2 杯拿铁和 1 个笔记本' } });
    check('intent zh: 2 latte + 1 notebook', r.json.status === 'ok'
      && r.json.items.some(i => i.sku === 'SKU-LATTE' && i.qty === 2)
      && r.json.items.some(i => i.sku === 'SKU-NOTEBOOK' && i.qty === 1), JSON.stringify(r.json));

    r = await req('POST', '/api/intent', { body: { text: '2 latte and 1 notebook' } });
    check('intent en: 2 latte + 1 notebook', r.json.status === 'ok'
      && r.json.items.some(i => i.sku === 'SKU-LATTE' && i.qty === 2)
      && r.json.items.some(i => i.sku === 'SKU-NOTEBOOK' && i.qty === 1), JSON.stringify(r.json));

    r = await req('POST', '/api/intent', { body: { text: '拿铁两个' } });
    check('intent zh numeral: latte x2', r.json.status === 'ok' && r.json.items[0]?.qty === 2, JSON.stringify(r.json));

    r = await req('POST', '/api/intent', { body: { text: '来点好吃的' } });
    check('intent unknown -> unresolvable (no guess)', r.status === 422 && r.json.status === 'unresolvable');

    r = await req('POST', '/api/intent', { body: { text: '' } });
    check('intent empty -> unresolvable', r.status === 422);

    // ambiguity: 笔记本 contains 笔 — must resolve to notebook only, not both
    r = await req('POST', '/api/intent', { body: { text: '1 个笔记本' } });
    check('ambiguity: notebook only (笔 substring dropped)',
      r.json.status === 'ok' && r.json.items.length === 1 && r.json.items[0].sku === 'SKU-NOTEBOOK', JSON.stringify(r.json));

    // ===== order creation & tamper tests =====
    // get a session cookie
    let ses;
    const probe = await req('GET', '/api/catalog');
    // extract cookie from a real order flow
    async function newSessionOrder(items, clientTotal) {
      // first request in a session: use intent page then orders; cookie handling below
      const r1 = await req('POST', '/api/intent', { body: { text: '1 拿铁' } });
      // create with explicit items (server ignores intent), capture set-cookie via raw flow:
      return req('POST', '/api/orders', { body: { items, client_total_cents: clientTotal } });
    }

    // NOTE: session cookie: server sets on first response.
    // We emulate two sessions via explicit cookie jars.
    const jarA = 'pm_session=' + 'a'.repeat(32);
    const jarB = 'pm_session=' + 'b'.repeat(32);

    // 1) valid order
    r = await req('POST', '/api/orders', { cookie: jarA, body: { items: [{ sku: 'SKU-LATTE', qty: 2 }, { sku: 'SKU-NOTEBOOK', qty: 1 }] } });
    check('order created (201)', r.status === 201, JSON.stringify(r.json));
    const orderId = r.json.order_id;
    // server total for 2x450 + 1x1250 = 2150
    check('server recomputed total = 2150', r.json.total_cents === 2150, String(r.json.total_cents));

    // 2) tampered client total recorded but NOT trusted
    r = await req('POST', '/api/orders', { cookie: jarA, body: { items: [{ sku: 'SKU-LATTE', qty: 1 }], client_total_cents: 1 } });
    check('tampered client total ignored (server price wins)',
      r.status === 201 && r.json.total_cents === 450, JSON.stringify(r.json));
    const tamperId = r.json.order_id;
    const o = (await req('GET', `/api/orders/${tamperId}`, { cookie: jarA })).json;
    check('tamper evidence stored (client_total_cents=1, total=450)',
      o.client_total_cents === 1 && o.total_cents === 450);

    // 3) tampered amount in items? qty is integer; try float
    r = await req('POST', '/api/orders', { cookie: jarA, body: { items: [{ sku: 'SKU-LATTE', qty: 1.5 }] } });
    check('float qty rejected', r.status === 400 && /QTY_MUST_BE_INTEGER|INVALID_QTY/.test(r.json.error), JSON.stringify(r.json));

    // 4) qty 0 / negative / over cap
    r = await req('POST', '/api/orders', { cookie: jarA, body: { items: [{ sku: 'SKU-LATTE', qty: 0 }] } });
    check('qty=0 rejected', r.status === 400);
    r = await req('POST', '/api/orders', { cookie: jarA, body: { items: [{ sku: 'SKU-LATTE', qty: -2 }] } });
    check('negative qty rejected', r.status === 400);
    r = await req('POST', '/api/orders', { cookie: jarA, body: { items: [{ sku: 'SKU-LATTE', qty: 11 }] } });
    check('qty>10 rejected', r.status === 400 && /INVALID_QTY/.test(r.json.error));

    // 5) unknown SKU
    r = await req('POST', '/api/orders', { cookie: jarA, body: { items: [{ sku: 'SKU-NOPE', qty: 1 }] } });
    check('unknown SKU rejected', r.status === 400 && /UNKNOWN_SKU/.test(r.json.error));

    // 6) order too large (sum qty > 20)
    r = await req('POST', '/api/orders', { cookie: jarA, body: { items: [{ sku: 'SKU-LATTE', qty: 10 }, { sku: 'SKU-MUG', qty: 10 }, { sku: 'SKU-PEN', qty: 5 }] } });
    check('order total qty > 20 rejected', r.status === 400 && /ORDER_TOO_LARGE|INVALID_QTY/.test(r.json.error), JSON.stringify(r.json));

    // ===== cross-session ownership =====
    r = await req('GET', `/api/orders/${orderId}`, { cookie: jarB });
    check('cross-session GET rejected (404)', r.status === 404);
    r = await req('POST', `/api/orders/${orderId}/confirm`, { cookie: jarB });
    check('cross-session confirm rejected (404)', r.status === 404);
    r = await req('GET', `/api/orders/${orderId}/events`, { cookie: jarB });
    check('cross-session events rejected (404)', r.status === 404);

    // ===== full happy path with MOCK =====
    r = await req('POST', `/api/orders/${orderId}/confirm`, { cookie: jarA });
    check('confirm: draft->created via MOCK create', r.status === 200 && r.json.order.status === 'created'
      && /^MOCK-PAYPAL-/.test(r.json.order.paypal_order_id), JSON.stringify(r.json.order?.status));
    check('adapter label MOCK', r.json.adapter === 'MOCK');

    // illegal: capture before approve
    r = await req('POST', `/api/orders/${orderId}/capture`, { cookie: jarA });
    check('capture before approve rejected (409)', r.status === 409 && /ILLEGAL_TRANSITION/.test(r.json.error));

    r = await req('POST', `/api/orders/${orderId}/approve`, { cookie: jarA });
    check('approve: created->approved', r.status === 200 && r.json.order.status === 'approved');

    // capture x2 (sequential idempotency)
    r = await req('POST', `/api/orders/${orderId}/capture`, { cookie: jarA });
    check('capture ok -> captured', r.status === 200 && r.json.order.status === 'captured');
    const cap1 = r.json.capture.capture_id;
    r = await req('POST', `/api/orders/${orderId}/capture`, { cookie: jarA });
    check('repeat capture idempotent (same capture_id, idempotent flag)',
      r.status === 200 && r.json.idempotent === true && r.json.capture.capture_id === cap1, JSON.stringify(r.json));

    // terminal: cancel after captured
    r = await req('POST', `/api/orders/${orderId}/cancel`, { cookie: jarA });
    check('cancel after captured rejected (409)', r.status === 409);

    // ===== cancel path =====
    r = await req('POST', `/api/orders`, { cookie: jarA, body: { items: [{ sku: 'SKU-MUG', qty: 1 }] } });
    const cancelId = r.json.order_id;
    await req('POST', `/api/orders/${cancelId}/confirm`, { cookie: jarA });
    r = await req('POST', `/api/orders/${cancelId}/cancel`, { cookie: jarA });
    check('cancel after confirm works', r.status === 200 && r.json.order.status === 'cancelled');
    r = await req('POST', `/api/orders/${cancelId}/capture`, { cookie: jarA });
    check('capture after cancel rejected (409)', r.status === 409);

    // ===== concurrent capture idempotency =====
    r = await req('POST', `/api/orders`, { cookie: jarA, body: { items: [{ sku: 'SKU-TOTE', qty: 1 }] } });
    const ccId = r.json.order_id;
    await req('POST', `/api/orders/${ccId}/confirm`, { cookie: jarA });
    await req('POST', `/api/orders/${ccId}/approve`, { cookie: jarA });
    const [c1, c2, c3] = await Promise.all([
      req('POST', `/api/orders/${ccId}/capture`, { cookie: jarA }),
      req('POST', `/api/orders/${ccId}/capture`, { cookie: jarA }),
      req('POST', `/api/orders/${ccId}/capture`, { cookie: jarA }),
    ]);
    const capIds = [c1, c2, c3].map(x => x.json?.capture?.capture_id || x.json?.order?.capture_result_json);
    const okAll = [c1, c2, c3].every(x => x.status === 200);
    const ids = [c1, c2, c3].map(x => (x.json.capture ? x.json.capture.capture_id : null)).filter(Boolean);
    check('concurrent captures all 200', okAll, JSON.stringify([c1.status, c2.status, c3.status]));
    // exactly one real capture: unique capture ids <= 1 (idempotent returns carry same id)
    const uniqueIds = new Set(ids);
    check('concurrent capture -> single capture id (or idempotent no-op)', uniqueIds.size <= 1, JSON.stringify([...uniqueIds]));
    // exactly one captured->captured transition logged, others idempotent
    const ev = (await req('GET', `/api/orders/${ccId}/events`, { cookie: jarA })).json.events;
    const captureTransitions = ev.filter(e => /transition approved -> captured/.test(e.event)).length;
    check('event log: exactly one approved->captured transition', captureTransitions === 1, JSON.stringify(ev.map(e=>e.event)));

    // ===== double confirm attempt =====
    r = await req('POST', `/api/orders/${ccId}/confirm`, { cookie: jarA });
    check('confirm after captured rejected (409)', r.status === 409);

    // ===== non-owner concurrency sanity: jarB still blocked =====
    r = await req('POST', `/api/orders/${ccId}/capture`, { cookie: jarB });
    check('cross-session capture still rejected', r.status === 404);

  } finally {
    server.kill();
    try { fs.unlinkSync(dbFile); } catch {}
  }

  console.log(results.join('\n'));
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
