'use strict';
// No real credentials and no PayPal network requests. These tests exercise the
// boundary contract and state handling; they do not establish live integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const adapters = require('../lib/adapters');
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
async function rejects(name, fn, pattern) { await assert.rejects(fn, pattern); checks++; console.log('PASS ' + name); }

function harness() {
  const state = {approval:'CREATED',captureHttp:200,captureStatus:'COMPLETED',currency:'USD',value:'21.50',linkHost:'www.sandbox.paypal.com',calls:[]};
  const adapter = adapters.paypalSandboxAdapter({clientId:'fixture-client',clientSecret:'fixture-only-not-real',returnBase:'http://127.0.0.1:19773',fetchImpl:async (url, init) => {
    state.calls.push({url,init});
    if (!url.startsWith('https://api-m.sandbox.paypal.com/')) throw new Error('Forbidden external target');
    let data, status = 200;
    if (url.endsWith('/oauth2/token')) data = {access_token:'fixture-token',expires_in:3600};
    else if (url.endsWith('/capture')) {
      status = state.captureHttp;
      data = {id:'TESTORDER123',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'CAPTURE123',status:state.captureStatus,amount:{currency_code:state.currency,value:state.value}}]}}]};
    } else if (init.method === 'POST') data = {id:'TESTORDER123',links:[{rel:'approve',href:`https://${state.linkHost}/checkoutnow?token=FIXTURE`} ]};
    else data = {id:'TESTORDER123',status:state.approval,purchase_units:[{amount:{currency_code:state.currency,value:state.value}}],links:[{rel:'approve',href:`https://${state.linkHost}/checkoutnow?token=FIXTURE`}]};
    return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  }});
  return {state,adapter};
}

(async () => {
  let server;
  try {
    const {state,adapter} = harness();
    const order = {orderDb:{id:'PM-CONTRACT'},items:[{sku:'SKU-LATTE',qty:2,unit_price_cents:450},{sku:'SKU-NOTEBOOK',qty:1,unit_price_cents:1250}],totalCents:2150};
    const pay = await adapter.createOrder(order);
    check('create uses Sandbox approval URL', () => assert.match(pay.approveUrl,/^https:\/\/www\.sandbox\.paypal\.com\//));
    const create = state.calls.find(c => c.url.endsWith('/v2/checkout/orders'));
    const body = JSON.parse(create.init.body);
    check('create uses stable idempotency key', () => assert.equal(create.init.headers['PayPal-Request-Id'],'PM-CONTRACT-create'));
    check('server amount and item sum sent in integer-cent-derived USD', () => { assert.equal(body.purchase_units[0].amount.value,'21.50'); assert.equal(body.purchase_units[0].items[0].unit_amount.value,'4.50'); });
    check('return address is configured application origin', () => assert.equal(body.payment_source.paypal.experience_context.return_url,'http://127.0.0.1:19773/order/PM-CONTRACT'));
    await rejects('approval is not inferred from a local button', () => adapter.verifyApproval({paypalOrderId:'TESTORDER123',totalCents:2150}), /APPROVAL_PENDING/);
    state.approval = 'APPROVED';
    await adapter.verifyApproval({paypalOrderId:'TESTORDER123',totalCents:2150});
    checks++; console.log('PASS provider approval verified');
    state.currency = 'EUR';
    await rejects('wrong approval currency rejected', () => adapter.verifyApproval({paypalOrderId:'TESTORDER123',totalCents:2150}), /AMOUNT/);
    state.currency = 'USD'; state.value = '20.00';
    await rejects('wrong approved amount rejected', () => adapter.verifyApproval({paypalOrderId:'TESTORDER123',totalCents:2150}), /AMOUNT_MISMATCH/);
    state.value = '21.50';
    await rejects('capture requires persistent local idempotency key', () => adapter.captureOrder({paypalOrderId:'TESTORDER123',totalCents:2150}), /IDEMPOTENCY_KEY_REQUIRED/);
    const captureArgs = {paypalOrderId:'TESTORDER123',totalCents:2150,idempotencyKey:'PM-CONTRACT'};
    state.captureHttp = 422;
    await rejects('HTTP 422 never becomes success', () => adapter.captureOrder(captureArgs), /CAPTURE_FAILED \(422\)/);
    state.captureHttp = 200; state.captureStatus = 'PENDING';
    await rejects('pending capture never becomes completed', () => adapter.captureOrder(captureArgs), /NOT_COMPLETED/);
    state.captureStatus = 'COMPLETED'; state.value = '99.00';
    await rejects('captured amount mismatch rejected', () => adapter.captureOrder(captureArgs), /AMOUNT_MISMATCH/);
    state.value = '21.50';
    const cap = await adapter.captureOrder(captureArgs);
    check('returns capture id rather than provider order id', () => assert.equal(cap.capture_id,'CAPTURE123'));
    check('capture requests ask for a full representation', () => assert.equal(state.calls.filter(c => c.url.endsWith('/capture')).at(-1).init.headers.Prefer,'return=representation'));
    check('all capture retries use same provider idempotency key', () => assert.ok(state.calls.filter(c => c.url.endsWith('/capture')).every(c => c.init.headers['PayPal-Request-Id'] === 'PM-CONTRACT-capture')));
    check('OAuth token reused within adapter', () => assert.equal(state.calls.filter(c => c.url.endsWith('/oauth2/token')).length,1));
    check('all provider requests have a timeout signal', () => assert.ok(state.calls.every(c => c.init.signal instanceof AbortSignal)));
    state.linkHost = 'www.paypal.com';
    await rejects('production approval link rejected', () => adapter.createOrder(order), /APPROVAL_LINK_INVALID/);

    // Integration boundary: use an injected Sandbox contract double, while the
    // client below sends real HTTP to the local server. There is no PayPal I/O.
    const integration = harness();
    adapters.getAdapter = () => integration.adapter;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'checkoutlab-paypal-contract-'));
    process.env.PAYMATE_DB = path.join(tmp,'orders.db');
    process.env.PAYMATE_PORT = '19773';
    process.env.PAYMATE_ENABLE_AI = 'false';
    server = require('../server').server;
    await new Promise((resolve,reject) => {server.once('error',reject);server.listen(19773,'127.0.0.1',resolve);});
    const call = async (route, body) => {
      const r = await fetch('http://127.0.0.1:19773'+route,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(4000),headers:{'Content-Type':'application/json',Cookie:'pm_session='+'b'.repeat(32)},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:r.status,data:await r.json()};
    };
    const o = await call('/api/orders',{items:[{sku:'SKU-LATTE',qty:2},{sku:'SKU-NOTEBOOK',qty:1}]});
    const prefix = '/api/orders/'+o.data.order_id;
    const c = await call(prefix+'/confirm',{});
    check('HTTP Sandbox create returns approval link', () => {assert.equal(c.status,200);assert.match(c.data.approve_url,/sandbox\.paypal\.com/);});
    integration.state.linkHost = 'www.paypal.com';
    const badLink = await call(prefix+'/confirm',{});
    const stillAlive = await call(prefix);
    check('failed approval-link lookup does not crash server or change order', () => {assert.equal(badLink.status,500);assert.equal(stillAlive.data.status,'created');});
    integration.state.linkHost = 'www.sandbox.paypal.com';
    const denied = await call(prefix+'/approve',{});
    check('unverified provider approval blocked at HTTP boundary', () => assert.equal(denied.status,409));
    const unchanged = await call(prefix);
    check('order remains created after false approval', () => assert.equal(unchanged.data.status,'created'));
    integration.state.approval = 'APPROVED';
    const approved = await call(prefix+'/approve',{});
    check('HTTP approval follows provider verification', () => assert.equal(approved.data.order.status,'approved'));
    integration.state.captureHttp = 422;
    const rejected = await call(prefix+'/capture',{});
    check('provider 422 gives HTTP 502, never a captured order', () => assert.equal(rejected.status,502));
    const still = await call(prefix);
    check('failed provider capture leaves approved state retryable', () => assert.equal(still.data.status,'approved'));
    integration.state.captureHttp = 200;
    const completed = await call(prefix+'/capture',{});
    check('verified capture marks order captured', () => {assert.equal(completed.data.order.status,'captured');assert.equal(completed.data.capture.capture_id,'CAPTURE123');});
    const again = await call(prefix+'/capture',{});
    check('HTTP repeated capture returns stored capture id', () => {assert.equal(again.data.idempotent,true);assert.equal(again.data.capture.capture_id,'CAPTURE123');});
    const page = await fetch('http://127.0.0.1:19773/order/'+o.data.order_id,{signal:AbortSignal.timeout(4000)});
    const html = await page.text();
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) check('Sandbox order-page JavaScript compiles', () => {new (require('node:vm').Script)(match[1]);});
    check('Sandbox banner does not claim MOCK integration', () => assert.match(html,/PayPal SANDBOX — test funds only/));
    console.log(`Sandbox contract: ${checks} checks passed; zero real PayPal requests; this suite does not exercise the live adapter (see STATUS.md for the one recorded sandbox run).`);
  } catch(e) {console.error(e);process.exitCode=1;}
  finally {if(server?.listening) await new Promise(resolve=>server.close(resolve));}
})();
