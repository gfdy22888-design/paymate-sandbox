'use strict';
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkoutlab-learning-'));
process.env.PAYMATE_DB = path.join(dir, 'test.db');
process.env.PAYMATE_PORT = '19767';
process.env.PAYMATE_ENABLE_AI = 'false';
process.env.PAYMATE_ENABLE_PAYPAL = 'false';
const { predict, info } = require('../lib/learning_model');
const { server } = require('../server');
let checks = 0;
function check(label, fn) { fn(); checks++; console.log('PASS ' + label); }

(async () => {
  try {
    check('training source is explicit synthetic data', () => { assert.equal(info.training_documents, 21); assert.match(info.training_source, /synthetic/); });
    for (const [text, sku] of [['milk coffee','SKU-LATTE'], ['black strong shot','SKU-ESPRESSO'], ['paper lecture notes','SKU-NOTEBOOK'], ['black ink instrument','SKU-PEN'], ['ceramic handle vessel','SKU-MUG'], ['reusable canvas bag','SKU-TOTE'], ['fresh tea leaves','SKU-GREENTEA']]) {
      check('held-out teaching phrase: ' + text, () => { const p = predict(text); assert.equal(p.status, 'suggestion'); assert.equal(p.sku, sku); assert.equal(p.action, 'TEACHING_SUGGESTION_ONLY'); });
    }
    for (const text of ['', 'spaceship rocket', '不要奶咖', 'coffee or tea', 'x'.repeat(513), '<script>alert(1)</script>']) {
      check('abstains on unsupported input', () => assert.equal(predict(text).status, 'abstain'));
    }
    check('deterministic inference', () => assert.deepEqual(predict('milk coffee'), predict('milk coffee')));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(19767, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:19767';
    const request = (route, options = {}) => fetch(base + route, {signal:AbortSignal.timeout(4000), ...options});
    const meta = await (await request('/api/learn/model')).json();
    check('HTTP metadata identifies local model', () => assert.equal(meta.external_calls, false));
    const result = await (await request('/api/learn/predict', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'milk coffee'})})).json();
    check('HTTP returns a suggestion, no order identifier', () => { assert.equal(result.sku, 'SKU-LATTE'); assert.equal(result.order_id, undefined); });
    const cross = await request('/api/learn/predict', {method:'POST',headers:{Origin:'https://evil.example'},body:'{}'});
    check('ML route keeps same-origin guard', () => assert.equal(cross.status, 403));
    const invalid = await request('/api/learn/predict', {method:'POST',headers:{'Content-Type':'application/json'},body:'{"text":true}'});
    check('invalid ML payload rejected', () => assert.equal(invalid.status, 400));
    const html = await (await request('/')).text();
    check('learning controls are included on home page', () => { assert.match(html, /CheckoutLab/); assert.match(html, /classifyLocally/); });
    for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      check('generated page script compiles', () => { new (require('node:vm').Script)(script[1]); });
    }
    // Exercise the generated UI logic against actual HTTP without pretending this
    // is a browser layout/click-through test.
    const elements = {modelText:{value:'milk coffee'},modelResult:{textContent:''},useModelSuggestion:{hidden:true}};
    const vm = require('node:vm');
    const context = vm.createContext({document:{getElementById:id=>elements[id]},location:{href:''},fetch:(route,options)=>request(route,{...options,headers:{...options.headers,Cookie:'pm_session='+'c'.repeat(32)}})});
    vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1],context);
    await vm.runInContext('classifyLocally()',context);
    check('UI logic exposes draft action only after a suggestion', () => assert.equal(elements.useModelSuggestion.hidden,false));
    check('classification itself never navigates or creates a draft', () => assert.equal(context.location.href,''));
    await vm.runInContext('draftFromSuggestion()',context);
    const uiId = context.location.href.split('/').at(-1);
    const uiDraft = await (await request('/api/orders/'+uiId,{headers:{Cookie:'pm_session='+'c'.repeat(32)}})).json();
    check('explicit suggestion action creates draft, not approved payment', () => {assert.equal(uiDraft.status,'draft');assert.equal(uiDraft.items[0].sku,'SKU-LATTE');assert.equal(uiDraft.items[0].qty,1);assert.equal(uiDraft.paypal_order_id,null);});
    console.log(`Learning checks: ${checks} passed, 0 failed. These fixtures are not a real-world accuracy benchmark.`);
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { if (server.listening) await new Promise(resolve => server.close(resolve)); }
})();
