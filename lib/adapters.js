// adapters.js — payment adapter layer: mock (default, offline) + paypal sandbox (disabled by default)
// NO outbound network calls unless PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are BOTH set
// AND PAYMATE_ENABLE_PAYPAL === 'true'. Defaults never touch the network.
'use strict';

// ---------- MOCK adapter (default) ----------
// Simulates Orders API v2 flow locally: create -> buyer approval -> capture.
// All outputs are labelled MOCK. No network.
const mockAdapter = {
  name: 'MOCK',
  isLive: false,
  async createOrder({ orderDb, items, totalCents }) {
    const paypalOrderId = 'MOCK-PAYPAL-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    return {
      paypalOrderId,
      approveUrl: `/mock-approve?order=${encodeURIComponent(orderDb.id)}&ppid=${paypalOrderId}`,
      label: 'MOCK',
    };
  },
  async captureOrder({ paypalOrderId }) {
    return {
      status: 'COMPLETED',
      label: 'MOCK',
      capture_id: 'MOCK-CAP-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      gross_amount: null, // filled by server from order total
    };
  },
};

// ---------- PayPal Sandbox adapter (written, OFF by default) ----------
// Requires: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYMATE_ENABLE_PAYPAL=true
// Never reads or logs secrets; token held in memory only.
function paypalSandboxAdapter(options = {}) {
  const API = 'https://api-m.sandbox.paypal.com';
  const request = options.fetchImpl || fetch;
  const clientId = options.clientId || process.env.PAYPAL_CLIENT_ID;
  const clientSecret = options.clientSecret || process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PAYPAL_CREDENTIALS_REQUIRED');
  const base = new URL(options.returnBase || process.env.PAYMATE_PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PAYMATE_PORT || 8787}`);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('PAYPAL_RETURN_BASE_INVALID');
  let tokenCache = null; // { value, expiresAt }

  async function jsonResponse(url, init, label) {
    const res = await request(url, {...init, signal:AbortSignal.timeout(10000)});
    if (!res.ok) throw new Error(`${label} (${res.status})`); // includes 422: never treat an error as capture success
    try { return await res.json(); } catch { throw new Error('PAYPAL_INVALID_JSON'); }
  }
  function orderPath(id) {
    if (typeof id !== 'string' || !/^[A-Z0-9]{1,36}$/.test(id)) throw new Error('PAYPAL_ORDER_ID_INVALID');
    return `${API}/v2/checkout/orders/${id}`;
  }
  function cents(amount) {
    if (!amount || amount.currency_code !== 'USD' || typeof amount.value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(amount.value)) throw new Error('PAYPAL_AMOUNT_INVALID');
    const [whole, fraction = ''] = amount.value.split('.');
    const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(value)) throw new Error('PAYPAL_AMOUNT_INVALID');
    return value;
  }
  function approvedLink(data) {
    const href = (data.links || []).find(l => l.rel === 'approve' || l.rel === 'payer-action')?.href;
    if (!href) return null;
    const u = new URL(href);
    if (u.protocol !== 'https:' || !['www.sandbox.paypal.com','sandbox.paypal.com'].includes(u.hostname) || u.username || u.password || u.port) throw new Error('PAYPAL_APPROVAL_LINK_INVALID');
    return u.href;
  }

  async function getToken() {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 30000) return tokenCache.value;
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const data = await jsonResponse(`${API}/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    }, 'PAYPAL_AUTH_FAILED');
    if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('PAYPAL_AUTH_RESPONSE_INVALID');
    tokenCache = { value: data.access_token, expiresAt: now + (data.expires_in || 0) * 1000 };
    return tokenCache.value; // never logged
  }

  return {
    name: 'PAYPAL_SANDBOX',
    isLive: true, // live = performs real network calls to sandbox (still not real money)
    async createOrder({ orderDb, items, totalCents }) {
      const token = await getToken();
      const data = await jsonResponse(`${API}/v2/checkout/orders`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `${orderDb.id}-create`, Prefer:'return=representation' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          payment_source: {paypal:{experience_context:{
            user_action:'PAY_NOW',
            return_url:new URL(`/order/${encodeURIComponent(orderDb.id)}`, base).href,
            cancel_url:new URL(`/order/${encodeURIComponent(orderDb.id)}?paypal_cancel=1`, base).href,
          }}},
          purchase_units: [{
            reference_id: orderDb.id,
            invoice_id: orderDb.id,
            amount: { currency_code: 'USD', value: (totalCents / 100).toFixed(2), breakdown: { item_total: { currency_code: 'USD', value: (totalCents / 100).toFixed(2) } } },
            items: items.map(it => ({
              sku: it.sku, quantity: String(it.qty),
              name: it.sku,
              unit_amount: { currency_code: 'USD', value: (it.unit_price_cents / 100).toFixed(2) },
            })),
          }],
        }),
      }, 'PAYPAL_CREATE_FAILED');
      orderPath(data.id);
      const approveUrl = approvedLink(data);
      if (!approveUrl) throw new Error('PAYPAL_APPROVAL_LINK_MISSING');
      return { paypalOrderId: data.id, approveUrl, label: 'PAYPAL_SANDBOX' };
    },
    async getApprovalLink({paypalOrderId}) {
      const token = await getToken();
      const data = await jsonResponse(orderPath(paypalOrderId), {headers:{Authorization:`Bearer ${token}`}}, 'PAYPAL_ORDER_LOOKUP_FAILED');
      if (data.id !== paypalOrderId) throw new Error('PAYPAL_ORDER_MISMATCH');
      return approvedLink(data);
    },
    async verifyApproval({paypalOrderId, totalCents}) {
      const token = await getToken();
      const data = await jsonResponse(orderPath(paypalOrderId), {headers:{Authorization:`Bearer ${token}`}}, 'PAYPAL_APPROVAL_LOOKUP_FAILED');
      if (data.id !== paypalOrderId || data.status !== 'APPROVED') throw new Error('PAYPAL_APPROVAL_PENDING');
      if (data.purchase_units?.length !== 1 || cents(data.purchase_units[0].amount) !== totalCents) throw new Error('PAYPAL_AMOUNT_MISMATCH');
      return true;
    },
    async captureOrder({ paypalOrderId, totalCents, idempotencyKey }) {
      if (typeof idempotencyKey !== 'string' || !idempotencyKey) throw new Error('PAYPAL_IDEMPOTENCY_KEY_REQUIRED');
      const token = await getToken();
      const data = await jsonResponse(orderPath(paypalOrderId) + '/capture', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `${idempotencyKey}-capture`, Prefer:'return=representation' },
        body:'{}',
      }, 'PAYPAL_CAPTURE_FAILED');
      const captures = data.purchase_units?.[0]?.payments?.captures;
      if (data.id !== paypalOrderId || data.status !== 'COMPLETED' || data.purchase_units?.length !== 1 || !Array.isArray(captures) || captures.length !== 1 || captures[0].status !== 'COMPLETED' || !captures[0].id) throw new Error('PAYPAL_CAPTURE_NOT_COMPLETED');
      if (cents(captures[0].amount) !== totalCents) throw new Error('PAYPAL_CAPTURE_AMOUNT_MISMATCH');
      return {status:'COMPLETED',label:'PAYPAL_SANDBOX',capture_id:captures[0].id,gross_amount:captures[0].amount};
    },
  };
}

let sandboxInstance;
function getAdapter() {
  if (process.env.PAYMATE_ENABLE_PAYPAL === 'true'
      && process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    return sandboxInstance || (sandboxInstance = paypalSandboxAdapter());
  }
  return mockAdapter;
}

// ---------- Optional AI-compatible adapter (OFF by default) ----------
// OpenAI-compatible endpoint via WorkBuddy Gateway. Disabled unless
// WORKBUDDY_BASE_URL + WORKBUDDY_API_KEY + PAYMATE_ENABLE_AI=true are set.
// URL/key stay server-side; never sent to frontend; never logged.
function getAiAdapter() {
  if (process.env.PAYMATE_ENABLE_AI !== 'true'
      || !process.env.WORKBUDDY_BASE_URL || !process.env.WORKBUDDY_API_KEY) {
    return null; // offline rule mode
  }
  const MAX_CALLS_PER_HOUR = parseInt(process.env.PAYMATE_AI_MAX_CALLS || '20', 10);
  let calls = [];
  return {
    async parseIntent(text) {
      const now = Date.now();
      calls = calls.filter(t => now - t < 3600000);
      if (calls.length >= MAX_CALLS_PER_HOUR) throw new Error('AI_RATE_LIMITED');
      calls.push(now);
      const res = await fetch(`${process.env.WORKBUDDY_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.WORKBUDDY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.PAYMATE_AI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Extract shopping intents. Reply ONLY JSON: {"items":[{"sku":"...","qty":1}]}. Allowed SKUs: SKU-LATTE,SKU-ESPRESSO,SKU-GREENTEA,SKU-NOTEBOOK,SKU-PEN,SKU-MUG,SKU-TOTE. If unclear, reply {"items":[]}.' },
            { role: 'user', content: text },
          ],
          temperature: 0,
        }),
      });
      if (!res.ok) throw new Error(`AI_FAILED (${res.status})`);
      const data = await res.json();
      return JSON.parse(data.choices[0].message.content);
    },
  };
}

module.exports = { getAdapter, getAiAdapter, mockAdapter, paypalSandboxAdapter };
