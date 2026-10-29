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
function paypalSandboxAdapter() {
  const API = 'https://api-m.sandbox.paypal.com';
  let tokenCache = null; // { value, expiresAt }

  async function getToken() {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 30000) return tokenCache.value;
    const creds = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`${API}/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PAYPAL_AUTH_FAILED (${res.status})`);
    const data = await res.json();
    tokenCache = { value: data.access_token, expiresAt: now + (data.expires_in || 0) * 1000 };
    return tokenCache.value; // never logged
  }

  return {
    name: 'PAYPAL_SANDBOX',
    isLive: true, // live = performs real network calls to sandbox (still not real money)
    async createOrder({ orderDb, items, totalCents }) {
      const token = await getToken();
      const res = await fetch(`${API}/v2/checkout/orders`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
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
      });
      if (!res.ok) throw new Error(`PAYPAL_CREATE_FAILED (${res.status})`);
      const data = await res.json();
      const approve = (data.links || []).find(l => l.rel === 'approve');
      return { paypalOrderId: data.id, approveUrl: approve ? approve.href : null, label: 'PAYPAL_SANDBOX' };
    },
    async captureOrder({ paypalOrderId }) {
      const token = await getToken();
      const res = await fetch(`${API}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok && res.status !== 422) throw new Error(`PAYPAL_CAPTURE_FAILED (${res.status})`);
      const data = await res.json();
      return { status: data.status, label: 'PAYPAL_SANDBOX', capture_id: data.id, raw_status: data.status };
    },
  };
}

function getAdapter() {
  if (process.env.PAYMATE_ENABLE_PAYPAL === 'true'
      && process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    return paypalSandboxAdapter();
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

module.exports = { getAdapter, getAiAdapter, mockAdapter };
