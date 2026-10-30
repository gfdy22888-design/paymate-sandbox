# CheckoutLab

**Demo video (2:50, public): https://youtu.be/_OxAlKRfZ7I**

## Quick start (offline demo)

On Windows, double-click the launcher script in the repo root, keep its window open, and visit **http://127.0.0.1:8787**. The script prefers a locally bundled Node; on other machines install Node.js 22+ (with `node:sqlite`) and run `node server.js`. This entry forces offline rule/local-teaching mode and MOCK payment, reads no `.env`, and needs no PayPal credentials.

Try `milk coffee` in the model panel, or type a shopping intent like `2 lattes and 1 notebook` (English and Chinese both supported), then click **Parse intent → Confirm order → Simulate buyer approval → Capture payment**. Everything is a sandbox/mock demonstration — no real charge ever happens.

An offline educational lab for separating a machine-learning suggestion from an authorized action. Built on the PayMate Sandbox mock-checkout prototype.

The new learning panel uses a real **multinomial Naive Bayes model fitted from 21 explicit synthetic teaching examples**. It classifies one product description, exposes matched features and score separation, and abstains when evidence is insufficient. It is not an LLM; its scores are not calibrated probabilities or real-world accuracy estimates. A prediction never creates or approves an order. The checkout below the panel retains its separate strict rule parser and human confirmation steps.

- No model download, external API, GPU or npm dependencies are required by the default path.
- Run: `node server.js`, then visit `http://127.0.0.1:8787`.
- Tests: run the three original suites below, `node test/learning.test.js` (24 checks), and `node test/paypal-contract.test.js` (29 checks using provider doubles). Total: 151 local regression checks; no live Sandbox calls are implied.
- Reproducible actual API execution: `node demo/run_demo.js demo/api-trace.json`.
- Current competition plan: Education track; [submission workflow](submission/WORKFLOW.md), [Devpost draft](submission/DEVPOST_DRAFT.md).
- The captioned demo is rendered from the saved actual API execution trace. It is **not a browser screen recording** and shows no live PayPal or external LLM call. Earlier `ui_*.png` screenshots belong to the original checkout UI validation.
- No contest registration, account-specific declaration or final submission has been completed. Public code and successful tests alone do not constitute an entry.

## Original mock-checkout core

Natural-language shopping intent → explainable order → **human confirmation** → MOCK sandbox checkout (PayPal Orders API v2 flow demonstration).

> Payment defaults to a local MOCK adapter, prominently labelled MOCK everywhere. **It is not a real payment** and is not connected to any real PayPal account. The PayPal Sandbox adapter is **integration-verified (2026-10-30, see below)**; the external LLM adapter remains **disabled and unverified**. The educational local classifier above does run without either adapter.

## Features

- **Deterministic rule-based intent parsing** (default, offline): Chinese/English shopping intents ("2 杯拿铁和 1 个笔记本" / "2 lattes and 1 notebook") → structured line items with per-item rationale. Unknown / ambiguous / negated / oversized inputs are **explicitly rejected — never guessed** (e.g. ambiguous connectives, negations, "laptop notebook", oversized quantities all → `unresolvable` with a reason).
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

The original three suites pass (98 checks), with 24 learning/API/UI-logic checks and 29 mocked Sandbox boundary checks (151 total). The historical remote Node 22 run and original UI validation are in `TEST_REPORT.md`; the current extension is described in `submission/ACCEPTANCE.md`.

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

**Status: integration-VERIFIED (2026-10-30).** End-to-end run against `api-m.sandbox.paypal.com` with real sandbox credentials: OAuth token (HTTP 200) → `POST /v2/checkout/orders` → PayPal order `2UV73710NH840425B` ($21.50) → buyer approval on the hosted sandbox page (`APPROVED`, confirmed via `GET /v2/checkout/orders/{id}`) → capture returned `COMPLETED`.

Use [the private Sandbox checklist](submission/PAYPAL_SANDBOX_CHECKLIST.md). An account email is not an API client ID. Credentials belong only in the gitignored `.env`; `node --env-file=.env server.js` or `bash start.sh` loads it. The adapter is fixed to Sandbox, verifies provider approval and capture amounts, uses stable idempotency keys, rejects HTTP errors/pending captures and does not accept production approval links. These boundaries have contract-double tests; live account integration is still pending.

## Optional external LLM adapter (OFF by default)

OpenAI-compatible backend (e.g. a deployed WorkBuddy Gateway). Requires `WORKBUDDY_BASE_URL` + `WORKBUDDY_API_KEY` + `PAYMATE_ENABLE_AI=true`; hourly call cap via `PAYMATE_AI_MAX_CALLS` (default 20). Only consulted when the rule parser fails; its output must pass the same server-side SKU/qty validation; any failure falls back to rule mode. The gateway URL/key stay server-side and never appear in frontend code or the public repo. **Status: implemented, unverified (no confirmed quota).**

## AI usage disclosure

See `AI_USAGE.md`: QwenPaw Agent (glm-5.3-flash) generated the original checkout core; Codex reviewed it and implemented the educational local model and new tests. **No human code review is claimed.** Original checkout browser validation predates the new panel; the panel has API, fixture and generated-script checks, but no completed browser click-through in this release. The PayPal Sandbox integration was verified end-to-end on 2026-10-30 (token → create order `2UV73710NH840425B` → buyer approval → capture `COMPLETED`). The external LLM adapter remains unverified.

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

**Submitted** to the PayPal AI Hackathon on 2026-10-30: https://devpost.com/software/checkoutlab-human-confirmed-ai-checkout . Demo video (2:50, Public): https://youtu.be/_OxAlKRfZ7I . Repository public, MIT licence visible in the About section, zero npm dependencies. Verified in a real browser: the checkout flow end to end (recording) and the teaching panel (suggestion -> unconfirmed draft, unknown input -> abstain, negation -> parser rejection). This hackathon's rules contain no live Demo Day gate; judging is asynchronous over 2026-12-01..2026-12-15 and winners are announced on or around 2026-12-21. See `STATUS.md` for exactly what is and is not verified.
