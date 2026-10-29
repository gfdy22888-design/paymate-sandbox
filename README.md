# PayMate Sandbox

Natural-language shopping intent → explainable order → **human confirmation** → MOCK sandbox checkout (PayPal Orders API v2 flow demonstration).

> **This is an offline demo MVP.** Payment defaults to a local MOCK adapter, prominently labelled MOCK everywhere. **It is not a real payment** and is not connected to any real PayPal account. PayPal Sandbox and AI adapters are implemented but **disabled and unverified** by default.

## Features

- **Deterministic rule-based intent parsing** (default, offline): Chinese/English shopping intents ("我要 2 杯拿铁和 1 个笔记本" / "2 notebook and 1 pen") → structured line items with per-item rationale. Unknown / ambiguous / negated / oversized inputs are **explicitly rejected — never guessed** (e.g. "拿铁或者绿茶", "不要拿铁", "laptop notebook", "拿铁 x1000" all → `unresolvable` with a reason).
- **Server-side price authority**: prices exist only in a server-side catalog constant; any client-sent total is recorded as `client_total_cents` for audit and **never trusted**; totals are recomputed server-side in integer cents.
- **Strict server-side validation**: SKU whitelist; quantity must be a JSON integer (not `true`, `"2"`, `1.5`); per-item cap 10; per-order total quantity cap 20; no silent clamping.
- **Human confirmation**: `draft → (user clicks Confirm) → created → buyer approves → approved → capture`.
- **Idempotent capture** under a per-order serial lock: sequential or concurrent repeated capture returns the same `capture_id`; the adapter is called **exactly once**; the event log records exactly one `approved → captured` transition.
- **Session-scoped orders**: HttpOnly `pm_session` cookie (32-hex, strictly validated); cross-session reads/actions → 404.
- **Full state machine**: `draft → confirmed → created → approved → captured / cancelled`; illegal transitions → 409; terminal states are final.
- **Input and output controls**: Host whitelist + exact Origin match on POSTs; invalid session formats and JSON are rejected; request bodies are size-limited (an oversized request may be disconnected). Client-sent `rationale` is never persisted; dynamic page values use escaping or `textContent`. Adapter failures leave the order retryable.

## Tech stack (zero dependencies)

Node.js 22 built-ins only (`http` + `node:sqlite`); **no npm packages, no build step**. Frontend is server-rendered HTML + vanilla JS. The implementation uses dependencies already available in its development environment. `node:sqlite` may emit an experimental-module warning on Node 22.

## Run

```bash
node server.js
# [paymate] listening on http://127.0.0.1:8787   (127.0.0.1 only — never exposed)
bash start.sh   # background via python3 subprocess, PID in server.pid, log in server.log
bash stop.sh
```

## Test

```bash
node test/unit.test.js       # 49 assertions: intent/catalog/state machine/adapter injection (concurrency, counting, failure recovery)
node test/security.test.js   # 15 assertions: Host/Origin guard, bad cookie/JSON/body, strong typing, XSS, route rejection
node test/e2e.test.js        # 34 assertions: full HTTP chain incl. tamper, cross-session, concurrent capture idempotency
```

All currently pass (98 total). Full logs: `TEST_REPORT.md`.

## PayPal Sandbox adapter (implemented, OFF by default)

```
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYMATE_ENABLE_PAYPAL=true
```

- Auth: `POST /v1/oauth2/token` with `grant_type=client_credentials` (server-side app credentials — **not** end-user login/authorization)
- Create: `POST /v2/checkout/orders` (amount built server-side from recomputed totals; `reference_id`/`invoice_id` = local order id)
- Capture: `POST /v2/checkout/orders/{id}/capture` after buyer approval on PayPal's hosted page
- Secrets live only in server env vars; never logged; token cached in memory only

**Status: code-ready, NOT integration-tested (no sandbox credentials). Do not claim verified until it has been run end-to-end.**

## Optional AI adapter (OFF by default)

OpenAI-compatible backend (e.g. a deployed WorkBuddy Gateway). Requires `WORKBUDDY_BASE_URL` + `WORKBUDDY_API_KEY` + `PAYMATE_ENABLE_AI=true`; hourly call cap via `PAYMATE_AI_MAX_CALLS` (default 20). Only consulted when the rule parser fails; its output must pass the same server-side SKU/qty validation; any failure falls back to rule mode. The gateway URL/key stay server-side and never appear in frontend code or the public repo. **Status: implemented, unverified (no confirmed quota).**

## AI usage disclosure

See `AI_USAGE.md`: QwenPaw Agent (glm-5.3-flash) generated the implementation; Codex supervised the work, reviewed code, requested fixes, and prepared this public release. **No human code review is claimed.** Automated tests and an agent-operated browser exercised the offline paths; the external integrations remain unverified.

## Project layout

```
server.js            HTTP server + pages + API (single entry)
lib/catalog.js       Fixed 7-SKU catalog + server-side total recomputation
lib/intent.js        Deterministic rule intent parser (offline baseline)
lib/store.js         Order persistence (node:sqlite) + state machine + session ownership
lib/adapters.js      MOCK / PayPal Sandbox / AI adapters (latter two default-off)
test/unit.test.js    Unit + concurrency + adapter-injection tests
test/security.test.js Security regressions (origin/cookie/JSON/XSS/typing)
test/e2e.test.js     Full HTTP chain tests
AI_USAGE.md          Truthful AI disclosure
DEMO_SCRIPT.md       3-minute demo script
TEST_REPORT.md       Real test run logs
STATUS.md            Verified vs unverified vs not-submission-ready
start.sh / stop.sh   Background run helpers
```

## License

MIT. See [LICENSE](LICENSE).

## Submission readiness

**Not ready for competition submission.** Outstanding: PayPal Sandbox integration testing, AI adapter verification, demo video recording, Devpost submission, and eligibility confirmation (age / residence). Public source repository: [gfdy22888-design/paymate-sandbox](https://github.com/gfdy22888-design/paymate-sandbox). Publication does not constitute contest registration or submission. See `STATUS.md`.
