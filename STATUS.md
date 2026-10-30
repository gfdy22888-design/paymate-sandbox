# STATUS.md — CheckoutLab (2026-10-30, Asia/Shanghai)

## Current educational extension

- Local Naive Bayes teaching model, teaching panel, and real-API demo scripts are implemented; the five local check suites currently pass 151/151 (including 24 learning-feature checks and 29 simulated Sandbox contract checks).
- Current direction is education; the default path depends on neither PayPal nor external model APIs. The PayPal Sandbox adapter was verified end-to-end once (2026-10-30, evidence below) and stays **off by default**; the external LLM adapter has never been exercised and must not be presented as verified.
- The participant's eligibility profile was reviewed privately against public age/enrollment criteria. Identity details are not written into the public repo; platform-specific and other eligibility statements must be completed truthfully by the participant.
- The English Devpost submission was filed on 2026-10-30; its drafts live under `submission/`. The demo video is a 2:50 browser screen recording of the MOCK flow (no terminal, no credentials on screen), published Public at https://youtu.be/_OxAlKRfZ7I.
- Done on 2026-10-30: YouTube upload (Public) and Devpost registration, rule acceptance and submission (https://devpost.com/software/checkoutlab-human-confirmed-ai-checkout). Done on 2026-10-31: browser click-through of the teaching panel (suggestion -> draft, unknown input -> abstain, negation -> parser rejection) with no defect found. There is no Demo Day in this hackathon's published rules; judging is asynchronous and winners are announced on or around 2026-12-21.
- The browser-automation tool connection dropped during a prior session; remote VPS cleanup could not be claimed. Historical test services were reported stopped; current resource headroom is unverified.
- GitHub CI: the `tests` run on `0223dc3` completed **success** (2026-10-30T14:21Z). Any later push needs its own green run. See `submission/ACCEPTANCE.md`.

## Historical PayMate Sandbox acceptance record (does not imply the new panel passed browser acceptance)

### Verified (with real execution evidence)

#### PayPal Sandbox live integration (2026-10-30)
- Credential validity: `POST /v1/oauth2/token` (client_credentials) → HTTP 200, access token valid 9h.
- Real order: `POST /v2/checkout/orders` → PayPal order `2UV73710NH840425B` (USD 21.50 = 2 lattes + 1 notebook); approve URL pointed to `www.sandbox.paypal.com/checkoutnow?token=...`, opened in a real browser to the genuine PayPal sign-in page.
- Buyer approval: completed by the human participant on PayPal's hosted page; `GET /v2/checkout/orders/{id}` returned `APPROVED`.
- Capture: local `/approve` → `/capture` (idempotent state machine) → PayPal returned `COMPLETED`, capture id `2UV73710NH840425B`.
- Adapter switch verified: after `start.sh` loaded `.env`, logs showed `payment adapter: PAYPAL_SANDBOX`; no secrets in logs (grep-verified).
- Note: sandbox credentials appeared in chat history; **Regenerate the secret** before final submission and update `.env`.

#### Offline features (previous acceptance round)
- Chinese/English intent parsing (pre/post quantity words, Chinese numerals, English numerals, `x2` suffixes, multi-item orders)
- Explicit rejections: 0/-1/1.5/100/1000 quantities, `x100`, negations, ambiguous connectives, unknown products, cross-matching traps, no silent truncation
- "notebook and gel pen" keeps both items (longest-match-wins)
- Server-side integer-cents recomputation; `client_total_cents` audit-only, never trusted; strict qty typing (true/"2"/1.5/None all → 400)
- State machine draft→confirmed→created→approved→captured/cancelled; illegal transitions → 409; terminal states locked
- Per-order serial lock: under concurrent confirm/capture the adapter is called exactly once, same capture id, exactly one transition in the event log
- cancel/capture races converge to a single terminal state; adapter failures leave orders retryable in draft
- Cross-session isolation (404); Host whitelist + exact Origin matching; invalid session formats/JSON rejected; oversized bodies limited (possibly by disconnect)
- Client rationale never persisted; frontend escapes or uses `textContent`; mock-approve parameter whitelist enforced
- UI: full order flow + idempotent re-click + ambiguity/negation rejection messages (screenshots on record)

## Not verified (explicitly not claimed)

- ~~PayPal Sandbox live calls~~ → ✅ verified 2026-10-30 (order `2UV73710NH840425B`, capture COMPLETED)
- AI adapter live calls (gateway quota/pricing unconfirmed)
- Multi-user load / long-run stability testing
- Demo video recording, public repo CI run on real GitHub (must check the new run after push)

## Not submission-ready

1. ~~PayPal sandbox credentials & integration~~ → ✅ done; remaining: **Regenerate secret** (credentials appeared in chat) and update `.env`
2. AI gateway quota confirmation → required before enabling/verifying the AI path
3. Eligibility self-check: age/residence (PayPal exclusion list), student status (backup contests)
4. Record and upload the demo video to YouTube (public)
5. Devpost account, official terms acceptance, final submission (participant actions)

## Git / GitHub

- Development commits: `f0c67ed` (MVP), `c0d01de` (docs). The public version additionally contains documentation corrections, the LICENSE, and further work; the public commit history on GitHub is authoritative.
- GitHub Actions workflow (Node 22 tests) in place at `.github/workflows/test.yml`.
- Public repo: https://github.com/gfdy22888-design/paymate-sandbox . Statements in the README do not by themselves constitute contest registration or submission; CI results are authoritative on GitHub Actions.

## Boundary statement

This round registered no contest accounts, accepted no terms, made no submission, moved no real money, and created no scheduled tasks; test servers bound only to 127.0.0.1 and were stopped after acceptance.
