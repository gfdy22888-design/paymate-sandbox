'use strict';
// A reproducible trace of actual local HTTP execution. No screenshots or outputs
// are fabricated; this does not record browser interaction or PayPal Sandbox.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkoutlab-demo-'));
process.env.PAYMATE_DB = path.join(dir, 'demo.db');
process.env.PAYMATE_PORT = '19769';
process.env.PAYMATE_ENABLE_AI = 'false';
process.env.PAYMATE_ENABLE_PAYPAL = 'false';
const { server } = require('../server');
const events = [];
const session = crypto.randomBytes(16).toString('hex');
const base = 'http://127.0.0.1:19769';
const record = (step, detail) => events.push({time:new Date().toISOString(),step,detail});
async function call(route, body) {
  const response = await fetch(base + route, {
    signal:AbortSignal.timeout(4000),
    method:body === undefined ? 'GET' : 'POST',
    headers:{'Content-Type':'application/json',Cookie:'pm_session=' + session},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  return {http:response.status, result:await response.json()};
}

(async () => {
  try {
    await new Promise((resolve, reject) => { server.once('error',reject); server.listen(19769,'127.0.0.1',resolve); });
    record('model', await call('/api/learn/model'));
    record('model_suggestion', await call('/api/learn/predict',{text:'milk coffee'}));
    record('model_abstains', await call('/api/learn/predict',{text:'spaceship rocket'}));
    record('ambiguous_order_rejected', await call('/api/intent',{text:'拿铁或者绿茶'}));
    const intent = await call('/api/intent',{text:'2 latte and 1 notebook'});
    record('validated_intent', intent);
    if (intent.http !== 200) throw new Error('Intent failed');
    const created = await call('/api/orders',{items:intent.result.items,client_total_cents:1});
    if (created.http !== 201 || created.result.total_cents !== 2150) throw new Error('Price authority failed');
    const id = created.result.order_id;
    record('price_authority',{claimed_cents:1,actual_cents:created.result.total_cents,state:'draft'});
    const early = await call('/api/orders/' + id + '/capture',{});
    if (early.http !== 409) throw new Error('Early capture was not rejected');
    record('capture_before_approval_rejected',early);
    for (const step of ['confirm','approve','capture']) {
      const r = await call('/api/orders/' + id + '/' + step,{});
      if (r.http !== 200) throw new Error(step + ' failed');
      record(step,{http:r.http,state:r.result.order.status,adapter:r.result.adapter || 'MOCK',capture_id:r.result.capture?.capture_id || null});
    }
    const repeated = await call('/api/orders/' + id + '/capture',{});
    const firstCapture = events.find(e => e.step === 'capture').detail.capture_id;
    if (!repeated.result.idempotent || repeated.result.capture.capture_id !== firstCapture) throw new Error('Idempotency failed');
    record('repeated_capture',{http:repeated.http,idempotent:true,same_capture_id:true});
    record('audit_events',(await call('/api/orders/' + id + '/events')).result);
    record('resources',{observed_rss_mib:Number((process.memoryUsage().rss / 1048576).toFixed(2)),node:process.version,external_requests:0,note:'One local process snapshot, not a VPS-wide measurement or peak-memory bound.'});
    const output = {kind:'actual-local-http-execution',recorded_at:new Date().toISOString(),browser_recording:false,real_paypal:false,events};
    const target = process.argv[2] || path.join(__dirname,'api-trace.json');
    fs.writeFileSync(target,JSON.stringify(output,null,2) + '\n');
    console.log('Actual demo trace saved: ' + target);
    console.log(events.map(e => e.step + ': ' + JSON.stringify(e.detail)).join('\n'));
  } catch(e) { console.error(e.message); process.exitCode = 1; }
  finally { if (server.listening) await new Promise(resolve => server.close(resolve)); }
})();
