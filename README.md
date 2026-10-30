# CheckoutLab

## 中文：先运行离线演示

Windows 用户可双击仓库中的 `运行本机演示.cmd`，保持启动窗口打开，然后在浏览器访问 **http://127.0.0.1:8787**。脚本会优先使用本机 Codex 自带的 Node；其他电脑需先安装支持 `node:sqlite` 的 Node.js 22 或更高版本。此入口强制使用离线规则/本地教学模型和 MOCK 支付，不读取 `.env`，不需要 PayPal 凭据。

先在上方输入 `milk coffee`，点击 **Get model suggestion** 查看模型建议；也可在下方输入 `我要 2 杯拿铁和 1 个笔记本`，点击“解析意图”，依次点击“确认订单 → 模拟买家批准 → 捕获付款”。全程为模拟演示，没有真实扣款。使用脚本启动时，按 Ctrl+C 或关闭启动窗口可停止。

其他系统在有 Node.js 22+ 的环境中运行 `node server.js`，再打开同一个地址。PayPal Sandbox 联调是另一个可选步骤，见下方说明。

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

> Payment defaults to a local MOCK adapter, prominently labelled MOCK everywhere. **It is not a real payment** and is not connected to any real PayPal account. The optional PayPal Sandbox and external LLM adapters remain **disabled and unverified**. The educational local classifier above does run without either adapter.

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

**Status: code-ready, NOT integration-tested (no sandbox credentials). Do not claim verified until it has been run end-to-end.**

Use [the private Sandbox checklist](submission/PAYPAL_SANDBOX_CHECKLIST.md). An account email is not an API client ID. Credentials belong only in the gitignored `.env`; `node --env-file=.env server.js` or `bash start.sh` loads it. The adapter is fixed to Sandbox, verifies provider approval and capture amounts, uses stable idempotency keys, rejects HTTP errors/pending captures and does not accept production approval links. These boundaries have contract-double tests; live account integration is still pending.

## Optional external LLM adapter (OFF by default)

OpenAI-compatible backend (e.g. a deployed WorkBuddy Gateway). Requires `WORKBUDDY_BASE_URL` + `WORKBUDDY_API_KEY` + `PAYMATE_ENABLE_AI=true`; hourly call cap via `PAYMATE_AI_MAX_CALLS` (default 20). Only consulted when the rule parser fails; its output must pass the same server-side SKU/qty validation; any failure falls back to rule mode. The gateway URL/key stay server-side and never appear in frontend code or the public repo. **Status: implemented, unverified (no confirmed quota).**

## AI usage disclosure

See `AI_USAGE.md`: QwenPaw Agent (glm-5.3-flash) generated the original checkout core; Codex reviewed it and implemented the educational local model and new tests. **No human code review is claimed.** Original checkout browser validation predates the new panel; the panel has API, fixture and generated-script checks, but no completed browser click-through in this release. External integrations remain unverified.

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

**Not submitted.** The current educational competition path uses the local classifier and MOCK checkout; optional PayPal/LLM integration is not a prerequisite for that path. Remaining gates include browser verification, a verified YouTube/Vimeo demo URL, account-specific registration and rule acceptance, and Demo Day instructions/presentation. Public source repository: [gfdy22888-design/paymate-sandbox](https://github.com/gfdy22888-design/paymate-sandbox). See `STATUS.md` and the submission workflow.
