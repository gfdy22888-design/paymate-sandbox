// intent.js — deterministic rule-based shopping-intent parser (offline baseline)
// Explicitly NOT an AI. UI must label output as "离线规则模式 / Offline Rule Mode".
// Design principle: unknown / ambiguous / negated / unparseable input -> NOT ok. NEVER guess.
// Supported grammar (documented restriction):
//   [数量] 商品 (，和/and/加 [数量] 商品)*
//   数量: 1-999 阿拉伯数字 | 一二三...十 中文数字 | one..ten 英文 | x2/*2 后缀
//   否定词（不要/不想/别/no/not/without）出现在任一商品词前 => 整句拒绝（语义过于复杂，不支持）
'use strict';

const { MAX_QTY_PER_ITEM } = require('./catalog');

// Keyword -> SKU. zh + en variants. LONGEST-MATCH-WINS (笔 vs 中性笔 vs 笔记本).
// English plurals are listed explicitly (no stemming): the tokens are matched with
// letter-boundary lookarounds, so "lattes" would otherwise never match "latte".
const KEYWORDS = [
  { sku: 'SKU-LATTE',    terms: ['拿铁', 'latte', 'lattes'] },
  { sku: 'SKU-ESPRESSO', terms: ['浓缩咖啡', '浓缩', '特浓', 'espresso', 'espressos'] },
  { sku: 'SKU-GREENTEA', terms: ['绿茶', 'green tea', 'green teas'] },   // 抹茶 deliberately NOT a keyword (different product)
  { sku: 'SKU-NOTEBOOK', terms: ['笔记本', 'notebook', 'notebooks'] },
  { sku: 'SKU-PEN',      terms: ['中性笔', 'gel pen', 'gel pens', '圆珠笔', '笔', 'pen', 'pens'] },
  { sku: 'SKU-MUG',      terms: ['马克杯', '陶瓷杯', '杯子', 'mug', 'mugs'] }, // cup removed: too ambiguous vs 杯 classifier
  { sku: 'SKU-TOTE',     terms: ['帆布袋', '布袋', 'tote bag', 'tote bags', 'tote', 'totes'] },
];

const NEGATORS = ['不要', '不想', '别买', '别', '不来', '不要买', '免了', 'no ', 'not ', 'without', "don't", 'dont'];
const AMBIGUOUS_WORDS = ['或者', '还是', '随便', 'or ', 'maybe', 'either'];

const NUM_MAP = { '一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
const EN_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const ZH_CLS = '(?:个|只|杯|瓶|支|件|份|盒|包|台|本|块)';
const EN_WORD = '[a-z]+';

function unresolvable(reason, detail) {
  return { status: 'unresolvable', reason, items: [], mode: 'rule', ...(detail ? { detail } : {}) };
}

// find ALL word-boundary occurrences of a term in text (global, case-insensitive)
function findAll(text, term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b works for ascii; for zh, boundaries are just char positions (zh chars are not \w in JS by default => use lookarounds on non-CJK-letter context)
  const re = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, length: m[0].length });
    if (m.lastIndex === m.index) re.lastIndex++; // zero-length guard
  }
  return out;
}

function readQtyBefore(text, idx) {
  // text[0..idx): try to read trailing quantity "2 杯" / "两个" / "2" / "two"
  const before = text.slice(0, idx);
  let m = before.match(new RegExp(`(\\d{1,6})\\s*${ZH_CLS}?\\s*$`));
  if (m) return parseInt(m[1], 10);
  m = before.match(new RegExp(`([一二两三四五六七八九十])${ZH_CLS}?\\s*$`));
  if (m) return NUM_MAP[m[1]];
  m = before.match(new RegExp(`\\b(one|two|three|four|five|six|seven|eight|nine|ten)\\b\\s*$`, 'i'));
  if (m) return EN_NUM[m[1].toLowerCase()];
  return null; // no explicit qty
}

function readQtyAfter(text, endIdx) {
  // text[endIdx..]: "x2" | "*3" | "两个" | "2 杯" | "2"
  const rest = text.slice(endIdx);
  let m = rest.match(/^\s*[xX*×]\s*(\d{1,6})\b/);
  if (m) return parseInt(m[1], 10);
  m = rest.match(new RegExp(`^\\s*([一二两三四五六七八九十]|\\d{1,6})\\s*${ZH_CLS}?`));
  if (m) {
    const v = NUM_MAP[m[1]] !== undefined ? NUM_MAP[m[1]] : parseInt(m[1], 10);
    if (Number.isInteger(v)) return v;
  }
  return null;
}

function parse(text) {
  if (typeof text !== 'string' || !text.trim()) return unresolvable('EMPTY_INPUT');
  const t = text.toLowerCase();

  // negation anywhere => refuse (semantics unsupported; refusing is honest)
  for (const n of NEGATORS) {
    if (t.includes(n)) return unresolvable('NEGATION_UNSUPPORTED', [n.trim()]);
  }
  for (const a of AMBIGUOUS_WORDS) {
    if (t.includes(a.trim() + ' ') || t.includes(a)) return unresolvable('AMBIGUOUS_CONNECTIVE', [a.trim()]);
  }

  // collect ALL matches across keywords
  const matches = [];
  for (const kw of KEYWORDS) {
    for (const term of kw.terms) {
      for (const pos of findAll(t, term)) {
        matches.push({ sku: kw.sku, term, index: pos.index, end: pos.index + pos.length });
      }
    }
  }
  if (matches.length === 0) return unresolvable('NO_PRODUCT_MATCH');

  // longest-match-wins per span: drop matches fully contained in a longer match of another SKU
  const kept = matches.filter(m =>
    !matches.some(g => g !== m && g.sku !== m.sku && g.index <= m.index && g.end >= m.end && (g.end - g.index) > (m.end - m.index))
  );
  // Same-SKU overlapping duplicates (e.g. 中性笔@i contains 笔@i): keep longest per sku-span
  const dedup = [];
  for (const m of kept.sort((a, b) => (a.index - b.index) || (b.end - a.end))) {
    const last = dedup[dedup.length - 1];
    if (last && last.sku === m.sku && m.index < last.end) continue; // inside same-sku longer span
    dedup.push(m);
  }
  kept.length = 0; kept.push(...dedup);
  // overlapping same-position different SKU (not containment) => ambiguous
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const a = kept[i], b = kept[j];
      if (b.index < a.end && b.end > a.index) {
        return unresolvable('OVERLAPPING_MATCH', [a.term, b.term]);
      }
    }
  }

  // consume spans; anything between matches that isn't separator/junk => must be qty or separator, else reject
  const SEP_RE = /^(?:[\s,，、。.!！?？和与加再还要以及]+|and|plus|with)$/i;
  const items = [];
  let cursor = 0;
  for (const m of kept.sort((a, b) => a.index - b.index)) {
    const between = t.slice(cursor, m.index);
    if (between.trim() && !SEP_RE.test(between.trim())) {
      // must END with a qty pattern; leading filler words (我要/请给我/buy me...) tolerated
      const q = between.trim();
      const lead = '(?:[\\u4e00-\\u9fff]{1,4})?';   // short zh filler like 我要/请给我
      const qtyTail = new RegExp(`(?:^|\\s)${lead}\\s*(?:\\d{1,6}|[一二两三四五六七八九十])\\s*${ZH_CLS}?$`)
        .test(q) || /(?:^|[\s，,])(?:one|two|three|four|five|six|seven|eight|nine|ten)\b$/i.test(q);
      if (!qtyTail) return unresolvable('UNPARSED_SEGMENT', [q]);
    }
    // qty: explicit before > explicit after > default 1
    let qty = readQtyBefore(t, m.index);
    if (qty === null) qty = readQtyAfter(t, m.end);
    if (qty === null) qty = 1;
    // strict validation — no silent clamping
    if (!Number.isInteger(qty) || qty < 1) return unresolvable('INVALID_QTY', [String(qty)]);
    if (qty > MAX_QTY_PER_ITEM) return unresolvable('QTY_EXCEEDS_LIMIT', [String(qty), String(MAX_QTY_PER_ITEM)]);
    items.push({ sku: m.sku, qty, rationale: `Matched "${m.term}" at char ${m.index} → ${m.sku} × ${qty}` });
    cursor = m.end;
  }
  // trailing segment after last match: separator, "x2"-style, or qty-after pattern ("两个","2 杯"), else reject
  const tail = t.slice(cursor).trim();
  if (tail && !SEP_RE.test(tail)) {
    const tailOk =
      /^([xX*×]\s*\d{1,6})$/.test(tail) ||
      new RegExp(`^(?:\\d{1,6}|[一二两三四五六七八九十])\\s*${ZH_CLS}?$`).test(tail);
    if (!tailOk) return unresolvable('UNPARSED_SEGMENT', [tail]);
  }

  // dedupe same sku summing qty (two mentions of same product = add), then enforce per-item cap again
  const bySku = new Map();
  for (const it of items) {
    const prev = bySku.get(it.sku);
    if (prev) {
      prev.qty += it.qty;
      prev.rationale = `${prev.rationale}; repeated mention, total qty ${prev.qty}`;
    } else bySku.set(it.sku, it);
  }
  const merged = [...bySku.values()];
  for (const it of merged) {
    if (it.qty > MAX_QTY_PER_ITEM) return unresolvable('QTY_EXCEEDS_LIMIT', [String(it.qty), String(MAX_QTY_PER_ITEM)]);
  }
  return { status: 'ok', items: merged, mode: 'rule' };
}

module.exports = { parse, NEGATORS, AMBIGUOUS_WORDS };
