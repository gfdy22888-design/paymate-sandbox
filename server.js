// server.js — PayMate Sandbox. Pure Node built-ins (http + node:sqlite). Zero npm deps.
// Binds 127.0.0.1 only. No public exposure. MOCK-labelled payment by default.
'use strict';

const http = require('http');
const crypto = require('crypto');
const path = require('path');

const { CATALOG, computeTotalCents, getBySku, MAX_QTY_PER_ITEM, MAX_ITEMS_PER_ORDER } = require('./lib/catalog');
const intentParser = require('./lib/intent');
const learningModel = require('./lib/learning_model');
const store = require('./lib/store');
const { getAdapter, getAiAdapter } = require('./lib/adapters');

const PORT = parseInt(process.env.PAYMATE_PORT || '8787', 10);
const HOST = '127.0.0.1';
const aiAdapter = getAiAdapter();
const MAX_BODY = 20_000; // bytes

// ---------- per-order serial lock: guarantees adapter called once per transition ----------
const orderLocks = new Map(); // orderId -> Promise chain
function withOrderLock(id, fn) {
  const prev = orderLocks.get(id) || Promise.resolve();
  const next = prev.then(fn, fn); // run regardless of previous failure
  orderLocks.set(id, next);
  // cleanup: only if the Map still points at THIS chain (avoid clobbering a newer queued op)
  const cleanup = () => {
    if (orderLocks.get(id) === next) orderLocks.delete(id);
  };
  // A dangling .finally() would create a second, unhandled rejecting promise.
  // Consume both outcomes while the caller awaits the original chain.
  void next.then(cleanup, cleanup);
  return next;
}

// ---------- tiny helpers ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function html(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > MAX_BODY) { reject(Object.assign(new Error('BODY_TOO_LARGE'), { code: 413 })); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req);
  if (!raw || !raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('INVALID_JSON'), { code: 400 }); }
}
function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      if (!/^[A-Za-z0-9_]+$/.test(k)) continue; // strict cookie name; malformed -> ignored
      let v = part.slice(i + 1).trim();
      try { v = decodeURIComponent(v); } catch { continue; } // malformed encoding -> ignore cookie
      out[k] = v;
    }
  }
  return out;
}
function sessionOf(req, res) {
  const c = parseCookies(req);
  const existing = c.pm_session;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing; // strict format
  if (existing) return null; // present but malformed => reject (caller returns 400)
  const sid = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `pm_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
  return sid;
}
// Same-origin guard for state-changing POSTs.
// Host must be in the strict whitelist (actual bind address); Origin, when present,
// must exactly match a whitelisted origin. Rejects attacker-controlled Host+Origin pairs.
const HOST_WHITELIST = new Set([`${HOST}:${PORT}`]);
const ORIGIN_WHITELIST = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
function sameOriginOk(req) {
  const host = req.headers.host || '';
  if (!HOST_WHITELIST.has(host)) return false;           // malicious Host -> reject outright
  const origin = req.headers.origin;
  if (!origin) return true;                              // non-browser clients (curl/tests)
  return ORIGIN_WHITELIST.has(origin);                   // exact match; no parsing tricks
}

// ---------- HTML ----------
const MODE_LABEL = aiAdapter ? 'AI+规则回退（AI 未验证，仅实验）' : '离线规则模式 Offline Rule Mode';
function page(title, body) {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --banner:#b45309; --ok:#047857; --err:#b91c1c; }
  * { box-sizing:border-box; }
  body { font-family: system-ui, sans-serif; max-width:780px; margin:0 auto; padding:16px; color:#1f2937; }
  .banner { background:#fef3c7; border:2px solid var(--banner); color:var(--banner); font-weight:700; padding:10px 14px; border-radius:8px; margin-bottom:14px; text-align:center; }
  .mock { background:#fee2e2; border:2px dashed var(--err); color:var(--err); font-weight:700; padding:8px 12px; border-radius:8px; margin:10px 0; text-align:center; }
  .card { border:1px solid #d1d5db; border-radius:10px; padding:14px; margin:10px 0; }
  .muted { color:#6b7280; font-size:0.9em; }
  .mono { font-family: ui-monospace, monospace; }
  table { width:100%; border-collapse:collapse; }
  td, th { padding:6px 8px; border-bottom:1px solid #e5e7eb; text-align:left; }
  .amount { text-align:right; font-variant-numeric:tabular-nums; }
  button { font-size:1em; padding:8px 16px; border-radius:8px; border:1px solid #9ca3af; cursor:pointer; }
  .primary { background:#1d4ed8; color:#fff; border:none; }
  .danger { background:#fff; color:var(--err); border:1px solid var(--err); }
  input[type=text] { width:70%; padding:8px; font-size:1em; }
  .err { color:var(--err); font-weight:600; }
  .ok { color:var(--ok); font-weight:600; }
  .steps { font-size:0.85em; color:#6b7280; }
</style>
</head>
<body>
<div class="banner">⚠️ ${esc(MODE_LABEL)} ｜ 💰 ${getAdapter().isLive ? 'PayPal SANDBOX — test funds only; real integration still requires verification' : 'MOCK 非真实支付（PayPal Sandbox 流程演示；未做真实联调）'}</div>
${body}
</body>
</html>`;
}
function money(cents) { return '$' + (cents / 100).toFixed(2); }

function homePage() {
  const rows = CATALOG.map(p =>
    `<tr><td class="mono">${esc(p.sku)}</td><td>${esc(p.name_zh)} / ${esc(p.name_en)}</td><td class="amount">${money(p.unit_price_cents)}</td></tr>`).join('');
  return page('CheckoutLab — PayMate Sandbox', `
  <h1>CheckoutLab</h1>
  <p>Learn the boundary between a model suggestion and an authorized transaction. Built on the PayMate Sandbox offline prototype.</p>
  <p class="muted">自然语言购物意图 → 可解释订单 → 人工确认 → MOCK 沙箱结账（PayPal Orders v2 流程演示）</p>

  <div class="card">
    <h3>Learning experiment: a tiny local ML model</h3>
    <p>Multinomial Naive Bayes trained on 21 synthetic teaching examples, seven product classes. No API, downloads, or GPU. This is not an LLM; its score is not a calibrated probability. It never submits orders.</p>
    <label for="modelText">Describe one item (e.g. milk coffee, paper lecture notes, 帆布购物袋)</label><br>
    <input type="text" id="modelText" maxlength="512" value="milk coffee">
    <button onclick="classifyLocally()">Get model suggestion</button>
    <button id="useModelSuggestion" hidden onclick="draftFromSuggestion()">Use suggestion: create an unconfirmed draft (quantity 1)</button>
    <pre id="modelResult" style="white-space:pre-wrap" aria-live="polite"></pre>
    <p class="muted">Try an unknown product or a negation. Compare this statistical suggestion with the strict order parser below. Every payment action still needs a separate human click.</p>
  </div>

  <div class="card">
    <h3>① 描述你想买什么</h3>
    <input type="text" id="q" placeholder="例如：我要 2 杯拿铁和 1 个笔记本 / 2 latte and 1 notebook">
    <button class="primary" onclick="doIntent()">解析意图</button>
    <div id="intentResult" style="margin-top:10px"></div>
  </div>

  <div class="card">
    <h3>商品目录（服务端定价，共 ${CATALOG.length} 件）</h3>
    <table><tr><th>SKU</th><th>商品</th><th class="amount">单价</th></tr>${rows}</table>
    <p class="muted">单件数量上限 ${MAX_QTY_PER_ITEM}，每单总件数上限 ${MAX_ITEMS_PER_ORDER}。金额一律服务端重算；前端声称金额仅审计，不被信任。</p>
  </div>

  <div class="card steps">
    流程：解析意图 → <b>核对订单并点“确认订单”</b>（人工确认）→ MOCK 批准 → MOCK 捕获（幂等）。可选 AI 与 PayPal Sandbox 适配器已实现但默认关闭、未验证。
  </div>

  <script>
  let lastSuggestion = null;
  function escText(s){ const d=document.createElement('div'); d.textContent=String(s??''); return d.innerHTML; }
  async function classifyLocally() {
    const el = document.getElementById('modelResult');
    lastSuggestion = null;
    document.getElementById('useModelSuggestion').hidden = true;
    el.textContent = 'Classifying locally…';
    try {
      const r = await fetch('/api/learn/predict', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text:document.getElementById('modelText').value})});
      const data = await r.json();
      el.textContent = JSON.stringify(data, null, 2);
      if (data.status === 'suggestion') { lastSuggestion = data.sku; document.getElementById('useModelSuggestion').hidden = false; }
    } catch(e) { el.textContent = 'Request failed: ' + e.message; }
  }
  async function draftFromSuggestion() {
    if (!lastSuggestion) return;
    try {
      const r = await fetch('/api/orders', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{sku:lastSuggestion,qty:1}]})});
      const d = await r.json();
      if (r.status !== 201) { document.getElementById('modelResult').textContent = d.error || 'Draft rejected'; return; }
      location.href = '/order/' + encodeURIComponent(d.order_id);
    } catch(e) { document.getElementById('modelResult').textContent = 'Request failed: ' + e.message; }
  }
  async function doIntent() {
    const q = document.getElementById('q').value;
    const el = document.getElementById('intentResult');
    el.textContent = '解析中…';
    try {
      const r = await fetch('/api/intent', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text:q})});
      const d = await r.json();
      if (d.status !== 'ok') {
        el.textContent = '无法确定意图：' + (d.reason||'') + (d.detail? '（'+d.detail.join(' / ')+'）':'') + '。请明确写出目录中的商品名称与数量；系统不做猜测。';
        return;
      }
      // send only sku+qty; server computes price; omit client_total_cents (no fake numbers)
      const r2 = await fetch('/api/orders', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({items: d.items.map(i=>({sku:i.sku, qty:i.qty}))})});
      const d2 = await r2.json();
      if (d2.error) { el.textContent = '下单失败：' + d2.error; return; }
      location.href = '/order/' + encodeURIComponent(d2.order_id);
    } catch(e) { el.textContent = '请求失败：' + e.message; }
  }
  </script>`);
}

function orderPage(id) {
  const safeId = /^[A-Za-z0-9\-]+$/.test(id) ? id : '';
  return page('订单', `
  <h1>订单 <span class="mono" id="oid"></span></h1>
  <div id="content">加载中…</div>
  <div id="actions" style="margin-top:12px"></div>
  <script>
  const ORDER_ID = ${JSON.stringify(safeId)};
  const SANDBOX = ${Boolean(getAdapter().isLive)};
  let approvalUrl = null;
  let ORDER = null;
  function escText(s){ const d=document.createElement('div'); d.textContent=String(s??''); return d.innerHTML; }
  async function load() {
    const r = await fetch('/api/orders/' + encodeURIComponent(ORDER_ID));
    if (r.status === 404) { document.getElementById('content').textContent = '订单不存在或不属于当前会话。'; return; }
    ORDER = await r.json();
    render();
  }
  function render() {
    const o = ORDER;
    document.getElementById('oid').textContent = o.id;
    const rows = o.items.map(i =>
      '<tr><td class="mono">'+escText(i.sku)+'</td><td>'+escText(i.qty)+'</td><td class="amount">'+escText((i.unit_price_cents/100).toFixed(2))+'</td><td class="amount">'+escText((i.qty*i.unit_price_cents/100).toFixed(2))+'</td><td class="muted">'+escText(i.rationale||'')+'</td></tr>').join('');
    let statusLine = '<p>状态：<b>'+escText(o.status)+'</b> ｜ 服务端合计（权威）：<b>$'+escText((o.total_cents/100).toFixed(2))+'</b>'
      + (o.client_total_cents!=null ? ' ｜ 前端声称金额（仅审计，不被信任）：$'+escText((o.client_total_cents/100).toFixed(2)) : '')
      + (o.paypal_order_id ? ' ｜ 支付单号：<span class="mono">'+escText(o.paypal_order_id)+'</span>' : '') + '</p>';
    document.getElementById('content').innerHTML = statusLine +
      '<table><tr><th>SKU</th><th>数量</th><th class="amount">单价</th><th class="amount">小计</th><th>解析依据</th></tr>'+rows+'</table>';
    const a = document.getElementById('actions');
    if (o.status === 'draft') {
      a.innerHTML = '<button class="primary" onclick="act(\\'confirm\\')">确认订单（人工确认）</button> <button class="danger" onclick="act(\\'cancel\\')">取消</button>';
    } else if (o.status === 'created') {
      if (SANDBOX) {
        a.innerHTML = '<p>Use a Sandbox buyer account with test funds, then return here.</p>'
          + (approvalUrl ? '<p><a target="_blank" rel="noopener noreferrer" href="'+escText(approvalUrl)+'">Open PayPal SANDBOX approval</a></p>' : '<button onclick="act(\\'confirm\\')">Load Sandbox approval link</button>')
          + '<button onclick="act(\\'approve\\')">Verify buyer approval with Sandbox API</button> <button class="danger" onclick="act(\\'cancel\\')">Cancel</button>';
      } else {
        a.innerHTML = '<div class="mock">MOCK：模拟买家在 PayPal 页面批准（未连接真实 PayPal）</div><button class="primary" onclick="act(\\'approve\\')">模拟买家批准（MOCK approve）</button> <button class="danger" onclick="act(\\'cancel\\')">取消</button>';
      }
    } else if (o.status === 'approved') {
      a.innerHTML = '<button class="primary" onclick="act(\\'capture\\')">捕获付款（MOCK capture，幂等）</button> <button class="danger" onclick="act(\\'cancel\\')">取消</button>';
    } else if (o.status === 'captured') {
      a.innerHTML = '<p class="ok">✅ 已捕获（MOCK）。重复点击返回同一结果（幂等）。</p><button onclick="act(\\'capture\\')">再次点击验证幂等</button>';
    } else if (o.status === 'cancelled') {
      a.innerHTML = '<p class="err">订单已取消（终态）。</p>';
    } else if (o.status === 'confirmed') {
      a.innerHTML = '<p>确认中…</p>';
    }
    if (SANDBOX && ['draft','approved','captured'].includes(o.status)) {
      a.innerHTML = a.innerHTML.replaceAll('MOCK', 'SANDBOX test funds');
    }
  }
  async function act(step) {
    try {
      const r = await fetch('/api/orders/' + encodeURIComponent(ORDER_ID) + '/' + step, {method:'POST'});
      const d = await r.json();
      if (d.error) { alert('失败：' + d.error); }
      if (d.approve_url) approvalUrl = d.approve_url;
      if (d.order) ORDER = d.order;
      render();
    } catch(e) { alert('请求失败：' + e.message); }
  }
  if (ORDER_ID) load(); else document.getElementById('content').textContent = '非法订单号。';
  </script>`);
}

function mockApprovePage(orderId, ppid) {
  return page('MOCK 批准页', `
  <h1>MOCK PayPal 批准页</h1>
  <div class="mock">这不是 PayPal。这是本地模拟的“买家批准”步骤，用于演示 Orders API v2 流程。无真实资金。</div>
  <div class="card">
    <p>本地订单：<span class="mono">${esc(orderId)}</span></p>
    <p>MOCK PayPal 订单号：<span class="mono">${esc(ppid)}</span></p>
    <button class="primary" onclick="approveNow()">✅ 模拟买家批准（真实调用 approve 接口）</button>
    <button class="danger" onclick="location.href='/order/${esc(orderId)}'">返回订单（不批准）</button>
  </div>
  <script>
  async function approveNow() {
    const r = await fetch('/api/orders/${esc(orderId)}/approve', {method:'POST'});
    const d = await r.json();
    if (d.error) { alert('失败：' + d.error); }
    location.href = '/order/${esc(orderId)}';
  }
  </script>`);
}

// ---------- API ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const p = url.pathname;

    // --- pages (GET, no session needed to view shell; order data via API is session-scoped) ---
    if (p === '/' && req.method === 'GET') return html(res, 200, homePage());
    if (p === '/mock-approve' && req.method === 'GET') {
      const oid = url.searchParams.get('order') || '';
      const ppid = url.searchParams.get('ppid') || '';
      if (!/^[A-Za-z0-9\-]{1,64}$/.test(oid) || !/^[A-Za-z0-9\-]{1,64}$/.test(ppid)) {
        return html(res, 400, page('错误', '<p class="err">非法参数。</p>'));
      }
      return html(res, 200, mockApprovePage(oid, ppid));
    }
    const mOrderPage = p.match(/^\/order\/([A-Za-z0-9\-]{1,64})$/);
    if (mOrderPage && req.method === 'GET') return html(res, 200, orderPage(mOrderPage[1]));

    // --- session (strict) ---
    const session = sessionOf(req, res);
    if (session === null) return json(res, 400, { error: 'INVALID_COOKIE' });

    // --- same-origin for POST ---
    if (req.method === 'POST' && !sameOriginOk(req)) {
      return json(res, 403, { error: 'CROSS_ORIGIN_REJECTED' });
    }

    if (p === '/api/catalog' && req.method === 'GET') {
      return json(res, 200, { catalog: CATALOG, max_qty_per_item: MAX_QTY_PER_ITEM, max_items_per_order: MAX_ITEMS_PER_ORDER });
    }

    if (p === '/api/learn/model' && req.method === 'GET') return json(res, 200, learningModel.info);
    if (p === '/api/learn/predict' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body || typeof body.text !== 'string') return json(res, 400, {error:'TEXT_REQUIRED'});
      return json(res, 200, learningModel.predict(body.text));
    }

    if (p === '/api/intent' && req.method === 'POST') {
      const body = await readJson(req);
      if (typeof body.text !== 'string') return json(res, 400, { error: 'TEXT_REQUIRED' });
      let result = intentParser.parse(body.text);
      if (result.status !== 'ok' && aiAdapter) {
        try {
          const ai = await aiAdapter.parseIntent(body.text);
          if (ai && Array.isArray(ai.items) && ai.items.length > 0
              && ai.items.every(it => getBySku(it?.sku) && Number.isInteger(it?.qty) && it.qty >= 1 && it.qty <= MAX_QTY_PER_ITEM)) {
            result = { status: 'ok', items: ai.items.map(it => ({ sku: it.sku, qty: it.qty, rationale: 'AI 适配层解析（已通过服务端校验）' })), mode: 'ai' };
          }
        } catch { /* fall back to rule result */ }
      }
      // strip any client-provided rationale already (parser generates its own); be defensive:
      if (result.status === 'ok') result.items = result.items.map(i => ({ sku: i.sku, qty: i.qty, rationale: String(i.rationale || '').slice(0, 200) }));
      return json(res, result.status === 'ok' ? 200 : 422, result);
    }

    if (p === '/api/orders' && req.method === 'POST') {
      const body = await readJson(req);
      if (!Array.isArray(body.items) || body.items.length === 0) return json(res, 400, { error: 'ITEMS_REQUIRED' });
      try {
        const items = body.items.map(it => {
          if (typeof it !== 'object' || it === null || Array.isArray(it)) throw new Error('ITEM_MUST_BE_OBJECT');
          if (typeof it.sku !== 'string') throw new Error('SKU_MUST_BE_STRING');           // strong typing: no true->1
          const q = it.qty;
          if (typeof q !== 'number' || !Number.isInteger(q)) throw new Error('QTY_MUST_BE_INTEGER'); // rejects 1.5, "2", true
          const prod = getBySku(it.sku);
          if (!prod) throw new Error('UNKNOWN_SKU: ' + String(it.sku).slice(0, 40));
          if (q < 1 || q > MAX_QTY_PER_ITEM) throw new Error(`INVALID_QTY: ${prod.sku} qty=${q}`);
          // server-side price only; client rationale NEVER persisted
          return { sku: prod.sku, qty: q, unit_price_cents: prod.unit_price_cents, rationale: '服务端目录定价' };
        });
        const total = computeTotalCents(items);
        const clientTotal = Number.isInteger(body.client_total_cents) ? body.client_total_cents : null;
        const id = store.createOrder({ sessionId: session, items, totalCents: total, clientTotalCents: clientTotal });
        return json(res, 201, { order_id: id, total_cents: total });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    const mOrderApi = p.match(/^\/api\/orders\/([A-Za-z0-9\-]{1,64})(\/(confirm|approve|capture|cancel))?$/);
    if (mOrderApi && req.method === 'POST' && mOrderApi[3]) {
      const id = mOrderApi[1], step = mOrderApi[3];
      const result = await withOrderLock(id, async () => {
        const adapter = getAdapter();
        const o0 = store.getOrder(id, session);
        if (!o0) return { code: 404, body: { error: 'ORDER_NOT_FOUND_OR_NOT_YOURS' } };

        if (step === 'confirm') {
          if (o0.status === 'created' && o0.paypal_order_id) {
            // idempotent re-confirm after adapter success
            const approveUrl = adapter.isLive ? await adapter.getApprovalLink({paypalOrderId:o0.paypal_order_id}) : null;
            return { code: 200, body: { order: o0, idempotent: true, adapter: adapter.name, approve_url:approveUrl } };
          }
          if (o0.status !== 'draft') return { code: 409, body: { error: `ILLEGAL_TRANSITION: ${o0.status} -> confirmed` } };
          let pay;
          try {
            pay = await adapter.createOrder({ orderDb: o0, items: o0.items, totalCents: o0.total_cents });
          } catch (e) {
            // adapter failure: order stays draft; retryable
            return { code: 502, body: { error: 'ADAPTER_CREATE_FAILED', detail: e.message, retryable: true } };
          }
          store.transition(id, session, 'confirmed');
          const r2 = store.transition(id, session, 'created', { paypal_order_id: pay.paypalOrderId, note: `${adapter.name} create` });
          if (!r2.ok) return { code: r2.code, body: { error: r2.error } };
          return { code: 200, body: { order: store.getOrder(id, session), approve_url: pay.approveUrl, adapter: adapter.name } };
        }

        if (step === 'approve') {
          if (adapter.isLive && o0.status !== 'approved') {
            if (o0.status !== 'created') return {code:409,body:{error:'ILLEGAL_TRANSITION'}};
            try { await adapter.verifyApproval({paypalOrderId:o0.paypal_order_id,totalCents:o0.total_cents}); }
            catch { return {code:409,body:{error:'PAYPAL_APPROVAL_NOT_VERIFIED'}}; }
          }
          const r = store.transition(id, session, 'approved', { note: `${adapter.name} buyer approval` });
          if (!r.ok) return { code: r.code, body: { error: r.error, ...(r.idempotent ? { idempotent: true } : {}) } };
          return { code: 200, body: { order: r.order } };
        }

        if (step === 'capture') {
          if (o0.status === 'captured') {
            return { code: 200, body: { order: o0, idempotent: true, capture: JSON.parse(o0.capture_result_json || '{}') } };
          }
          if (o0.status !== 'approved') return { code: 409, body: { error: `ILLEGAL_TRANSITION: ${o0.status} -> captured` } };
          let cap;
          try {
            cap = await adapter.captureOrder({ paypalOrderId: o0.paypal_order_id, totalCents: o0.total_cents, idempotencyKey:id });
          } catch (e) {
            return { code: 502, body: { error: 'ADAPTER_CAPTURE_FAILED', detail: e.message, retryable: true } };
          }
          const r = store.transition(id, session, 'captured', {
            capture_result_json: JSON.stringify(cap), idempotency_key: id, note: `${adapter.name} capture`,
          });
          if (!r.ok && !r.idempotent) return { code: r.code, body: { error: r.error } };
          return { code: 200, body: { order: store.getOrder(id, session), capture: cap } };
        }

        if (step === 'cancel') {
          const r = store.transition(id, session, 'cancelled');
          if (!r.ok) return { code: r.code, body: { error: r.error } };
          return { code: 200, body: { order: r.order } };
        }
      });
      return json(res, result.code, result.body);
    }
    if (mOrderApi && req.method === 'GET' && !mOrderApi[3]) {
      const o = store.getOrder(mOrderApi[1], session);
      if (!o) return json(res, 404, { error: 'ORDER_NOT_FOUND_OR_NOT_YOURS' });
      return json(res, 200, o);
    }
    if (mOrderApi && req.method === 'GET' && mOrderApi[3] === undefined && p.endsWith('/events')) { /* unreachable */ }
    const mEvents = p.match(/^\/api\/orders\/([A-Za-z0-9\-]{1,64})\/events$/);
    if (mEvents && req.method === 'GET') {
      const ev = store.listEvents(mEvents[1], session);
      if (!ev) return json(res, 404, { error: 'ORDER_NOT_FOUND_OR_NOT_YOURS' });
      return json(res, 200, { events: ev });
    }

    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : 500;
    return json(res, code, { error: e.message === 'INVALID_JSON' ? 'INVALID_JSON' : e.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INTERNAL', detail: code === 500 ? e.message : undefined });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const adapter = getAdapter();
    console.log(`[paymate] listening on http://${HOST}:${PORT}`);
    console.log(`[paymate] payment adapter: ${adapter.name} ${adapter.isLive ? '(LIVE sandbox calls — UNVERIFIED)' : '(offline MOCK)'}`);
    console.log(`[paymate] intent mode: ${aiAdapter ? 'AI+rule fallback (AI UNVERIFIED)' : 'offline rule mode'}`);
  });
}

module.exports = { server, PORT, HOST };
