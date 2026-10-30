# Optional PayPal competition path — real Sandbox verification pending

This path is separate from the offline educational target. An existing PayPal account can be used to access the Developer Dashboard. The email address is not an API client ID, and a matching Google mailbox does not supply API credentials.

## Private setup

1. Open https://developer.paypal.com/ and sign in yourself using the existing PayPal account. Do not send the web password in chat.
2. Use an existing **Sandbox** REST application where possible. If a new app or account agreement is required, the participant must complete/confirm that action in the official dashboard.
3. Copy the Sandbox client ID and secret into the private, gitignored `.env` file. Never paste the secret in a chat, README, screenshot or public commit. Keep `PAYMATE_ENABLE_PAYPAL=false` until ready to run the test.
4. Run the server with environment-file loading: `node --env-file=.env server.js`, or use `bash start.sh`. Set `PAYMATE_PUBLIC_BASE_URL` to the application origin reachable by the browser; a local desktop test uses `http://127.0.0.1:8787`.
5. Use Sandbox buyer/seller test accounts and test funds. A normal PayPal account password is not an API secret or necessarily a Sandbox buyer credential. Do not switch to production endpoints or use real payment details.

## Required real verification

- Confirm one order and follow the returned Sandbox approval link.
- Complete buyer approval in the official Sandbox page; return and verify approval through the server. A local click must not manufacture approval.
- Capture only after that provider verification. Check returned capture status, USD amount and capture ID; test a retry with the same idempotency key.
- Record redacted evidence and errors without OAuth tokens, secrets, buyer passwords or personal information. Do not mark integration complete from mocked contract tests alone.

## Code preparation already covered by contract tests

Only the fixed Sandbox API host is used. Requests have timeouts, create/capture idempotency keys and full-response preferences. Provider approval and amounts are checked; HTTP 422, pending captures, amount mismatches and production approval URLs are rejected. Frontend mode labels distinguish MOCK and Sandbox. The callback is informational; server-side provider verification is authoritative.

Official references: https://developer.paypal.com/api/rest/authentication/ and https://developer.paypal.com/api/orders/v2/orders-capture .

Neither live Sandbox integration, PayPal contest registration, account-term acceptance nor final submission has been completed. The separate PayPal contest requires its own readiness check, functioning-demo footage and submission materials; the educational API-trace video is not evidence of a live PayPal integration.
