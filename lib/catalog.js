// catalog.js — fixed product catalog (server-side constant; single source of price truth)
'use strict';

// 7 SKUs. Prices in CENTS (integer). Currency fixed: USD.
// NOTE: mock demo data only. No real product store.
const CATALOG = [
  { sku: 'SKU-LATTE',    name_en: 'Latte',           name_zh: '拿铁',         unit_price_cents: 450,  currency: 'USD' },
  { sku: 'SKU-ESPRESSO', name_en: 'Espresso',        name_zh: '浓缩咖啡',     unit_price_cents: 300,  currency: 'USD' },
  { sku: 'SKU-GREENTEA', name_en: 'Green Tea',       name_zh: '绿茶',         unit_price_cents: 380,  currency: 'USD' },
  { sku: 'SKU-NOTEBOOK', name_en: 'Notebook',        name_zh: '笔记本',       unit_price_cents: 1250, currency: 'USD' },
  { sku: 'SKU-PEN',      name_en: 'Gel Pen',         name_zh: '中性笔',       unit_price_cents: 200,  currency: 'USD' },
  { sku: 'SKU-MUG',      name_en: 'Ceramic Mug',     name_zh: '陶瓷马克杯',   unit_price_cents: 990,  currency: 'USD' },
  { sku: 'SKU-TOTE',     name_en: 'Canvas Tote Bag', name_zh: '帆布袋',       unit_price_cents: 1500, currency: 'USD' },
];

const BY_SKU = new Map(CATALOG.map(p => [p.sku, p]));

const MAX_QTY_PER_ITEM = 10;     // server-side cap
const MAX_ITEMS_PER_ORDER = 20;  // server-side cap (sum of qty)

function getBySku(sku) {
  return BY_SKU.get(sku) || null;
}

// Recompute total from server-side catalog prices. Client-sent amounts are ignored.
function computeTotalCents(items) {
  let total = 0;
  let qtySum = 0;
  for (const it of items) {
    const p = BY_SKU.get(it.sku);
    if (!p) throw new Error(`UNKNOWN_SKU: ${it.sku}`);
    const q = Number(it.qty);
    if (!Number.isInteger(q) || q < 1 || q > MAX_QTY_PER_ITEM) {
      throw new Error(`INVALID_QTY: ${it.sku} qty=${it.qty}`);
    }
    total += p.unit_price_cents * q;
    qtySum += q;
    if (qtySum > MAX_ITEMS_PER_ORDER) throw new Error('ORDER_TOO_LARGE');
  }
  return total;
}

module.exports = { CATALOG, getBySku, computeTotalCents, MAX_QTY_PER_ITEM, MAX_ITEMS_PER_ORDER };
