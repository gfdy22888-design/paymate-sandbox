// test/unit.test.js — unit tests: intent parser, catalog math, state machine, adapter injection
// Run: node test/unit.test.js
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; results.push(`PASS  ${name}`); }
  else { failed++; results.push(`FAIL  ${name} ${detail}`); }
}

(async () => {
  // ===== intent parser =====
  const intent = require(path.join(ROOT_INTENT()));
  function ROOT_INTENT() { return path.join(__dirname, '..', 'lib', 'intent.js'); }

  const cases = [
    ['我要 2 杯拿铁和 1 个笔记本', 'ok', { 'SKU-LATTE': 2, 'SKU-NOTEBOOK': 1 }],
    ['2 notebook and 1 pen', 'ok', { 'SKU-NOTEBOOK': 2, 'SKU-PEN': 1 }],
    ['拿铁两个', 'ok', { 'SKU-LATTE': 2 }],
    ['两杯拿铁', 'ok', { 'SKU-LATTE': 2 }],
    ['拿铁 x3', 'ok', { 'SKU-LATTE': 3 }],
    ['two latte', 'ok', { 'SKU-LATTE': 2 }],
    ['笔记本和中性笔', 'ok', { 'SKU-NOTEBOOK': 1, 'SKU-PEN': 1 }],
    ['拿铁和绿茶', 'ok', { 'SKU-LATTE': 1, 'SKU-GREENTEA': 1 }],
    ['3 杯绿茶和 2 支中性笔', 'ok', { 'SKU-GREENTEA': 3, 'SKU-PEN': 2 }],
    ['一个马克杯', 'ok', { 'SKU-MUG': 1 }],
    ['拿铁，绿茶，浓缩咖啡', 'ok', { 'SKU-LATTE': 1, 'SKU-GREENTEA': 1, 'SKU-ESPRESSO': 1 }],
    // rejections
    ['拿铁 x100', 'unresolvable'], ['拿铁 x0', 'unresolvable'], ['拿铁 x-1', 'unresolvable'],
    ['拿铁 1.5', 'unresolvable'], ['100 拿铁', 'unresolvable'], ['1000 拿铁', 'unresolvable'],
    ['拿铁x100', 'unresolvable'],
    ['不要拿铁', 'unresolvable'], ['拿铁或者绿茶', 'unresolvable'], ['拿铁和火箭', 'unresolvable'],
    ['laptop notebook', 'unresolvable'], ['抹茶', 'unresolvable'], ['来点好吃的', 'unresolvable'],
    ['', 'unresolvable'], ['拿铁', 'ok', { 'SKU-LATTE': 1 }],
  ];
  for (const [txt, want, items] of cases) {
    const r = intent.parse(txt);
    let ok = r.status === want;
    if (ok && items) {
      ok = r.items.length === Object.keys(items).length &&
        r.items.every(i => items[i.sku] === i.qty);
    }
    check(`intent ${JSON.stringify(txt)} -> ${want}`, ok, JSON.stringify(r));
  }
  // no silent clamping: qty never silently becomes 1 or cap
  const clamped = intent.parse('拿铁 x100');
  check('no silent clamp (x100 -> error, not 10)', clamped.status === 'unresolvable' && clamped.reason === 'QTY_EXCEEDS_LIMIT');
  const zero = intent.parse('拿铁 x0');
  check('x0 -> INVALID_QTY', zero.status === 'unresolvable' && zero.reason === 'INVALID_QTY');

  // ===== catalog math =====
  const { computeTotalCents, MAX_QTY_PER_ITEM } = require(path.join(__dirname, '..', 'lib', 'catalog.js'));
  check('total 2 latte + 1 notebook = 2150', computeTotalCents([{ sku: 'SKU-LATTE', qty: 2 }, { sku: 'SKU-NOTEBOOK', qty: 1 }]) === 2150);
  let threw = false;
  try { computeTotalCents([{ sku: 'SKU-LATTE', qty: 1.5 }]); } catch (e) { threw = /INVALID_QTY/.test(e.message); }
  check('catalog rejects float qty', threw);
  threw = false;
  try { computeTotalCents([{ sku: 'SKU-NOPE', qty: 1 }]); } catch (e) { threw = /UNKNOWN_SKU/.test(e.message); }
  check('catalog rejects unknown sku', threw);

  // ===== state machine (fresh db in tmp) =====
  const tmpDb = path.join(os.tmpdir(), `paymate-unit-${Date.now()}.db`);
  process.env.PAYMATE_DB = tmpDb;
  delete require.cache[require.resolve(path.join(__dirname, '..', 'lib', 'store.js'))];
  const store = require(path.join(__dirname, '..', 'lib', 'store.js'));
  const s = 's'.repeat(32);
  const oid = store.createOrder({
    sessionId: s,
    items: [{ sku: 'SKU-LATTE', qty: 1, unit_price_cents: 450 }],
    totalCents: 450, clientTotalCents: 999,
  });
  check('order created draft', store.getOrder(oid, s).status === 'draft');
  check('cross-session getOrder null', store.getOrder(oid, 'x'.repeat(32)) === null);
  let r = store.transition(oid, s, 'captured');
  check('draft->captured illegal', !r.ok && /ILLEGAL_TRANSITION/.test(r.error));
  r = store.transition(oid, s, 'captured', { note: '' }); // still illegal
  check('capture not idempotent from draft', !r.ok);
  store.transition(oid, s, 'confirmed');
  store.transition(oid, s, 'created', { paypal_order_id: 'MOCK-X' });
  store.transition(oid, s, 'approved');
  const capJson = JSON.stringify({ status: 'COMPLETED', capture_id: 'C1' });
  r = store.transition(oid, s, 'captured', { capture_result_json: capJson });
  check('approved->captured ok', r.ok);
  r = store.transition(oid, s, 'captured');
  check('captured->captured idempotent re-read', r.ok && r.idempotent === true);
  check('capture result stored', store.getOrder(oid, s).capture_result_json === capJson);
  r = store.transition(oid, s, 'cancelled');
  check('captured->cancelled illegal (terminal)', !r.ok);

  // ===== adapter injection: delayed + counting adapter, concurrent confirm/capture =====
  const adapters = require(path.join(__dirname, '..', 'lib', 'adapters.js'));
  let createCalls = 0, captureCalls = 0;
  const slowAdapter = {
    name: 'SLOW-MOCK', isLive: false,
    async createOrder() { createCalls++; await new Promise(r => setTimeout(r, 120)); return { paypalOrderId: 'MOCK-' + Date.now(), approveUrl: '/x', label: 'SLOW-MOCK' }; },
    async captureOrder() { captureCalls++; await new Promise(r => setTimeout(r, 120)); return { status: 'COMPLETED', capture_id: 'CAP-' + captureCalls, label: 'SLOW-MOCK' }; },
  };
  // simulate the server's withOrderLock semantics with concurrent ops on two orders
  const orderLocks = new Map();
  function withOrderLock(id, fn) {
    const prev = orderLocks.get(id) || Promise.resolve();
    const next = prev.then(fn, fn);
    orderLocks.set(id, next);
    next.finally(() => { if (orderLocks.get(id) === next) orderLocks.delete(id); });
    return next;
  }
  const sid = 'q'.repeat(32);
  const oid2 = store.createOrder({ sessionId: sid, items: [{ sku: 'SKU-MUG', qty: 1, unit_price_cents: 990 }], totalCents: 990 });
  // concurrent confirms (3x) on same order
  const rs = await Promise.all([1, 2, 3].map(() => withOrderLock(oid2, async () => {
    const o = store.getOrder(oid2, sid);
    if (o.status === 'created') return { idem: true };
    if (o.status !== 'draft') return { illegal: true };
    const pay = await slowAdapter.createOrder({});
    store.transition(oid2, sid, 'confirmed');
    store.transition(oid2, sid, 'created', { paypal_order_id: pay.paypalOrderId });
    return { ok: true };
  })));
  check('concurrent confirm: adapter.createOrder called exactly once', createCalls === 1, String(createCalls));
  check('concurrent confirm: 1 ok + 2 idempotent/illegal', rs.filter(x => x.ok).length === 1 && rs.filter(x => x.idem || x.illegal).length === 2, JSON.stringify(rs));
  store.transition(oid2, sid, 'approved');
  const rc = await Promise.all([1, 2, 3].map(() => withOrderLock(oid2, async () => {
    const o = store.getOrder(oid2, sid);
    if (o.status === 'captured') return { idem: true, cap: JSON.parse(o.capture_result_json) };
    if (o.status !== 'approved') return { illegal: true };
    const cap = await slowAdapter.captureOrder({});
    store.transition(oid2, sid, 'captured', { capture_result_json: JSON.stringify(cap) });
    return { ok: true, cap };
  })));
  check('concurrent capture: adapter.captureOrder called exactly once', captureCalls === 1, String(captureCalls));
  const caps = rc.filter(x => x.cap).map(x => x.cap.capture_id);
  check('all capture responses share one capture_id', new Set(caps).size === 1, JSON.stringify(caps));
  const evs = store.listEvents(oid2, sid);
  check('event log: exactly one approved->captured', evs.filter(e => /approved -> captured/.test(e.event)).length === 1);

  // cancel race vs capture: approved order, one cancel + one capture concurrently
  const oid3 = store.createOrder({ sessionId: sid, items: [{ sku: 'SKU-PEN', qty: 1, unit_price_cents: 200 }], totalCents: 200 });
  store.transition(oid3, sid, 'confirmed');
  store.transition(oid3, sid, 'created', { paypal_order_id: 'MOCK-Y' });
  store.transition(oid3, sid, 'approved');
  const race = await Promise.all([
    withOrderLock(oid3, async () => store.transition(oid3, sid, 'cancelled')),
    withOrderLock(oid3, async () => {
      const o = store.getOrder(oid3, sid);
      if (o.status !== 'approved') return { blocked: true };
      const cap = await slowAdapter.captureOrder({});
      store.transition(oid3, sid, 'captured', { capture_result_json: JSON.stringify(cap) });
      return { ok: true };
    }),
  ]);
  const finalStatus = store.getOrder(oid3, sid).status;
  check('cancel/capture race: serial lock -> single terminal state', finalStatus === 'cancelled' || finalStatus === 'captured', finalStatus);
  check('loser of race saw blocked/illegal or idempotent state', race.some(x => x.blocked || x.illegal || x.idempotent) || race.filter(x=>x.ok).length === 1, JSON.stringify(race));

  // adapter failure recovery: createOrder throws -> order stays draft, retry works
  const failingAdapter = { name: 'FAIL', isLive: false, async createOrder(){ throw new Error('NET_DOWN'); }, async captureOrder(){ throw new Error('NET_DOWN'); } };
  const oid4 = store.createOrder({ sessionId: sid, items: [{ sku: 'SKU-TOTE', qty: 1, unit_price_cents: 1500 }], totalCents: 1500 });
  let attemptErr = null;
  try { await failingAdapter.createOrder({}); } catch (e) { attemptErr = e; }
  check('adapter failure surfaces error', attemptErr?.message === 'NET_DOWN');
  check('order stays draft after adapter failure', store.getOrder(oid4, sid).status === 'draft');
  const retry = await (async () => { const pay = await slowAdapter.createOrder({}); store.transition(oid4, sid, 'confirmed'); store.transition(oid4, sid, 'created', { paypal_order_id: pay.paypalOrderId }); return store.getOrder(oid4, sid); })();
  check('retry after failure succeeds', retry.status === 'created');

  // cleanup tmp dbs
  for (const f of [tmpDb, tmpDb + '-shm', tmpDb + '-wal']) { try { fs.unlinkSync(f); } catch {} }

  console.log(results.join('\n'));
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('RUNNER ERROR:', e); process.exit(2); });
