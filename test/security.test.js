// test/security.test.js — security & robustness regression suite (app-level, in-process server)
// Run: node test/security.test.js
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 19800 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; results.push(`PASS  ${name}`); }
  else { failed++; results.push(`FAIL  ${name} ${detail}`); }
}

function req(method, p, { body, cookie, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const r = http.request(`${BASE}${p}`, {
      method,
      headers: {
        Host: `127.0.0.1:${PORT}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
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
    r.setTimeout(4000, () => { r.destroy(); reject(new Error('TIMEOUT')); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  // PORT must be set BEFORE requiring server.js (whitelist is built at module load)
  process.env.PAYMATE_PORT = String(PORT);
  const { server } = require(path.join(ROOT, 'server.js'));
  // server.js only auto-listens when require.main; require as module = no listen. Listen explicitly:
  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(PORT, '127.0.0.1', res);
  });

  const jarA = 'pm_session=' + 'a'.repeat(32);
  const jarB = 'pm_session=' + 'b'.repeat(32);
  const jarBad = 'pm_session=not-hex';
  const GOOD_ORIGIN = `http://127.0.0.1:${PORT}`;

  try {
    // ===== host/origin guard =====
    let r = await req('POST', '/api/intent', { body: { text: '1 拿铁' }, cookie: jarA, headers: { Host: 'evil.example:80', Origin: 'http://evil.example:80' } });
    check('malicious Host rejected (403)', r.status === 403, String(r.status));
    r = await req('POST', '/api/intent', { body: { text: '1 拿铁' }, cookie: jarA, headers: { Origin: 'http://evil.example:80' } });
    check('good Host + evil Origin rejected (403)', r.status === 403);
    r = await req('POST', '/api/intent', { body: { text: '1 拿铁' }, cookie: jarA, headers: { Origin: GOOD_ORIGIN } });
    check('good Host + good Origin accepted', r.status === 200 || r.status === 422, String(r.status));

    // helper: attach good origin to all subsequent POSTs
    const post = (p, opts = {}) => req(p.replace(/^(\w+)/, '$1'), { ...opts, headers: { Origin: GOOD_ORIGIN, ...(opts.headers || {}) } });

    // ===== malformed cookie / json / body =====
    r = await req('POST', '/api/intent', { body: { text: 'x' }, cookie: jarBad });
    check('malformed session cookie -> 400', r.status === 400, String(r.status));
    r = await req('POST', '/api/intent', { cookie: jarA, body: '{not json', headers: { Origin: GOOD_ORIGIN } });
    check('invalid JSON -> 400', r.status === 400 && r.json?.error === 'INVALID_JSON', JSON.stringify(r.json));
    r = await req('POST', '/api/intent', { cookie: jarA, body: 'x'.repeat(30000), headers: { Origin: GOOD_ORIGIN } }).catch(e => ({ status: 0, json: null, text: String(e) }));
    check('oversized body -> 413/destroyed', r.status === 413 || r.status === 0, String(r.status));

    // ===== strong typing: true/'2'/1.5 as qty =====
    for (const bad of [true, '2', 1.5, null]) {
      r = await req('POST', '/api/orders', { cookie: jarA, body: { items: [{ sku: 'SKU-LATTE', qty: bad }] }, headers: { Origin: GOOD_ORIGIN } });
      check(`qty=${JSON.stringify(bad)} rejected (400)`, r.status === 400, JSON.stringify(r.json));
    }

    // ===== XSS: rationale/script never persisted or echoed =====
    r = await req('POST', '/api/orders', { cookie: jarA, body: { items: [{ sku: 'SKU-LATTE', qty: 1, rationale: '<script>alert(1)</script>' }] }, headers: { Origin: GOOD_ORIGIN } });
    const oid = r.json.order_id;
    r = await req('GET', `/api/orders/${oid}`, { cookie: jarA });
    check('client rationale not persisted', !JSON.stringify(r.json).includes('<script>'), JSON.stringify(r.json).slice(0, 200));
    const page = await req('GET', `/order/${oid}`, { cookie: jarA });
    check('order page served as text/html', (page.headers['content-type'] || '').includes('text/html'));
    check('order page escapes via client-side textContent (no server-side injection of raw rationale)',
      !page.text.includes('<script>alert(1)</script>'));

    // ===== mock-approve query escaping =====
    r = await req('GET', '/mock-approve?order=' + encodeURIComponent('<img src=x onerror=alert(1)>') + '&ppid=ABC');
    check('mock-approve rejects malicious order param (400)', r.status === 400, String(r.status));

    // ===== adapter-failure recovery: confirm retryable =====
    // use the server's lock directly? Instead test via HTTP with an injected bad adapter is not possible
    // without env restart; covered by unit test in unit.adapter.test.js. Here verify draft survives a
    // forced failure by confirming an order whose adapter throws (simulate via disabled env? skip if not injectable)
    // -> covered in unit tests.

    // ===== XSS in order id param: URL-encode script tag -> server route regex rejects -> 404 (safe) =====
    r = await req('GET', '/order/%3Cscript%3E');
    check('bad order id page -> 404 (route regex rejects, no echo)', r.status === 404 && !r.text.includes('<script>alert'), String(r.status));

  } finally {
    server.close();
  }

  console.log(results.join('\n'));
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('RUNNER ERROR:', e); process.exit(2); });
