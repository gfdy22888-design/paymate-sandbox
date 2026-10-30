'use strict';

// An educational multinomial Naive Bayes model, fitted from explicit toy examples.
// These are synthetic teaching fixtures, not collected customer data or a benchmark.
const DATA = {
  'SKU-LATTE': ['latte milk coffee milky espresso drink', 'creamy coffee with milk', '拿铁 奶咖 牛奶咖啡'],
  'SKU-ESPRESSO': ['espresso concentrated coffee black strong shot', 'small intense espresso shot', '浓缩咖啡 黑咖啡 特浓'],
  'SKU-GREENTEA': ['green tea leaves herbal light tea drink', 'fresh green tea leaves', '绿茶 茶叶 清茶'],
  'SKU-NOTEBOOK': ['notebook paper pages writing notes journal', 'paper journal for lecture notes', '笔记本 纸张 本子 课堂笔记'],
  'SKU-PEN': ['pen ink writing instrument stationery', 'gel pen with black ink', '中性笔 墨水 写字 文具笔'],
  'SKU-MUG': ['mug ceramic cup drinking handle', 'ceramic drinking vessel with handle', '马克杯 陶瓷杯 杯子 把手'],
  'SKU-TOTE': ['tote reusable fabric bag carrying shopping', 'canvas cloth reusable shopping bag', '帆布袋 布袋 购物袋 环保袋'],
};

function tokenize(text) {
  const normalized = text.toLowerCase().normalize('NFKC');
  const features = (normalized.match(/[a-z]+/g) || []).map(w => 'w:' + w);
  for (const run of normalized.match(/[\u4e00-\u9fff]+/g) || []) {
    for (let i = 0; i < run.length - 1; i++) features.push('c:' + run.slice(i, i + 2));
  }
  return features;
}

function fit(data) {
  const vocabulary = new Set();
  const classes = [];
  for (const [sku, documents] of Object.entries(data)) {
    const counts = new Map();
    let total = 0;
    for (const text of documents) for (const feature of tokenize(text)) {
      vocabulary.add(feature);
      counts.set(feature, (counts.get(feature) || 0) + 1);
      total++;
    }
    classes.push({ sku, counts, total });
  }
  return { vocabulary, classes };
}

const fitted = fit(DATA);
const info = Object.freeze({
  type: 'multinomial-naive-bayes',
  training_documents: Object.values(DATA).reduce((s, docs) => s + docs.length, 0),
  classes: fitted.classes.length,
  features: fitted.vocabulary.size,
  training_source: 'agent-authored synthetic teaching examples in lib/learning_model.js',
  external_calls: false,
  caveat: 'Toy classifier. Scores are not calibrated probabilities or measured real-world accuracy. Predictions never create or approve an order.',
});

function predict(text) {
  const abstain = reason => ({ status: 'abstain', reason, model: info.type });
  if (typeof text !== 'string' || !text.trim()) return abstain('EMPTY_INPUT');
  if (text.length > 512) return abstain('INPUT_TOO_LONG');
  if (/不要|不买|或者|还是|\b(?:not|without|either|or)\b/i.test(text)) return abstain('NEGATION_OR_AMBIGUITY');
  const features = [...new Set(tokenize(text))];
  const known = features.filter(f => fitted.vocabulary.has(f));
  if (known.length < 2 || known.length / Math.max(features.length, 1) < 0.4) return abstain('INSUFFICIENT_EVIDENCE');
  const ranked = fitted.classes.map(c => ({
    sku: c.sku,
    score: -Math.log(fitted.classes.length) + known.reduce((s, f) => s + Math.log(((c.counts.get(f) || 0) + 1) / (c.total + fitted.vocabulary.size)), 0),
  })).sort((a, b) => b.score - a.score);
  const gap = ranked[0].score - ranked[1].score;
  if (gap < 0.8) return abstain('LOW_SEPARATION');
  return {
    status: 'suggestion', model: info.type, sku: ranked[0].sku,
    log_score_gap: Number(gap.toFixed(4)),
    matched_features: known.map(f => f.slice(2)),
    action: 'TEACHING_SUGGESTION_ONLY',
    caveat: info.caveat,
  };
}

module.exports = { predict, info, tokenize };
