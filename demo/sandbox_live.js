'use strict';
// Explicit, API-only Sandbox verification helper. It never targets production,
// logs credentials, or proves browser UI readiness. Buyer approval is separate.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { paypalSandboxAdapter } = require('../lib/adapters');
const action = process.argv[2];
if (!process.argv.includes('--allow-sandbox-network') || !['create','status','capture'].includes(action)) {
  console.error('Usage: node --env-file=.env demo/sandbox_live.js create|status|capture --allow-sandbox-network');
  process.exit(2);
}
const statePath = path.join(__dirname,'..','data','sandbox-verification.json');
function save(value) {
  fs.mkdirSync(path.dirname(statePath),{recursive:true});
  fs.writeFileSync(statePath,JSON.stringify(value,null,2)+'\n',{mode:0o600});
}
(async () => {
  const adapter = paypalSandboxAdapter({returnBase:'http://127.0.0.1:19775'});
  if (action === 'create') {
    if (fs.existsSync(statePath)) throw new Error('EXISTING_SANDBOX_VERIFICATION_STATE_PRESERVED');
    const localId = 'PM-SBX-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    const result = await adapter.createOrder({orderDb:{id:localId},items:[{sku:'SKU-LATTE',qty:1,unit_price_cents:450}],totalCents:450});
    const state = {kind:'PAYPAL_SANDBOX_API_ONLY',localId,paypalOrderId:result.paypalOrderId,totalCents:450,approveUrl:result.approveUrl,createdAt:new Date().toISOString(),captured:false};
    save(state);
    console.log(JSON.stringify({sandbox:true,realMoney:false,amount:'4.50 USD test funds',paypalOrderId:state.paypalOrderId,approvalUrl:state.approveUrl,next:'Buyer approval in official Sandbox, then run status/capture. This is not the full web UI test.'}));
    return;
  }
  const state = JSON.parse(fs.readFileSync(statePath,'utf8'));
  if (state.kind !== 'PAYPAL_SANDBOX_API_ONLY' || state.totalCents !== 450 || typeof state.localId !== 'string') throw new Error('INVALID_PRIVATE_SANDBOX_STATE');
  if (state.captured) {
    console.log(JSON.stringify({sandbox:true,alreadyRecorded:true,result:state.capture}));
    return;
  }
  await adapter.verifyApproval({paypalOrderId:state.paypalOrderId,totalCents:state.totalCents});
  if (action === 'status') {console.log(JSON.stringify({sandbox:true,approved:true,paypalOrderId:state.paypalOrderId}));return;}
  const capture = await adapter.captureOrder({paypalOrderId:state.paypalOrderId,totalCents:state.totalCents,idempotencyKey:state.localId});
  state.captured = true;
  state.capture = capture;
  state.capturedAt = new Date().toISOString();
  save(state);
  console.log(JSON.stringify({sandbox:true,realMoney:false,result:capture}));
})().catch(e => {console.error('Sandbox verification: ' + (e.code === 'ENOENT' ? 'PRIVATE_STATE_NOT_FOUND' : e.message));process.exitCode=1;});
