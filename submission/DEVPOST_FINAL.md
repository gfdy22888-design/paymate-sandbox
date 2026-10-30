# Devpost submission — paste-ready (CheckoutLab)

> Status: **not submitted.** Submission needs (a) the public YouTube URL and (b) the participant's
> own Devpost account + acceptance of the Official Rules. Everything below is prepared for paste.
> Deadline: **Nov 13, 2026 03:00 GMT+7** (≈14 days from 2026-10-30). No tracks exist in this
> hackathon — the earlier "Primary track: Education" line in `DEVPOST_DRAFT.md` is obsolete.

---

## Field: Project name

```
CheckoutLab — Human-Confirmed AI Checkout
```

## Field: Elevator pitch (≤200 chars)

```
An offline learning lab that shows — in source code and in a running checkout — why an AI suggestion must never be the thing that actually moves your money.
```

## Field: Video link (YouTube, public)

```
<PASTE YOUTUBE URL — required, must be public>
```

## Field: Repository (public, MIT license)

```
https://github.com/gfdy22888-design/paymate-sandbox
```

## Field: "Try it out" / run instructions

```
git clone https://github.com/gfdy22888-design/paymate-sandbox && cd paymate-sandbox
node server.js          # Node 22+, zero npm dependencies
# open http://127.0.0.1:8787
# type: 2 lattes and 1 notebook  -> Parse intent -> Confirm order -> mock approval -> Capture
```

## Field: Tools / AI services used, and how

```
AI: a local multinomial Naive Bayes classifier (7 product classes, 21 explicit synthetic
teaching examples) implemented from scratch in ~100 lines — no API, no download, no GPU.
It only ever produces a suggestion; it cannot create or approve an order. An optional LLM
adapter path exists and is disabled by default.

PayPal: Orders v2 (POST /v2/checkout/orders, buyer approval, POST .../capture) with
client_credentials server-side auth; the MOCK adapter reproduces the same create → approve →
capture state machine offline, and the PayPal Sandbox adapter was verified end-to-end against
the sandbox (order 2UV73710NH840425B, capture COMPLETED — see STATUS.md). The demo video runs
in MOCK mode on purpose: no credentials, tokens or real funds ever appear on screen.

Runtime: Node 22 built-ins only (node:http, node:sqlite).
Built during the hackathon with AI coding agents (QwenPaw / glm-5.3-flash and Codex); the full
disclosure is in AI_USAGE.md.
```

## Field: "About the project" (markdown body)

```markdown
## Inspiration

Teaching materials about agents rarely show the exact point where a plausible model output
becomes an authorized payment. CheckoutLab makes that boundary a thing you can click, break and
test — with a mock checkout that has real failure cases and no real money or customer data.

## What it does

A tiny multilingual Naive Bayes classifier suggests a product class for a free-text description
and shows its matched features and score separation, or abstains when evidence is thin. Students
can turn a suggestion into an **unconfirmed draft** — the model never submits an order.

A separate, strict rule parser turns bilingual input ("2 杯拿铁和 1 个笔记本" / "2 lattes and
1 notebook") into line items and shows **why each item matched** (which term, at which position).
Anything ambiguous, negated, unknown or oversized is rejected with an explicit reason — the
system never guesses, and never silently clamps a quantity to the limit.

Prices are recomputed server-side in integer cents against a fixed 7-item catalog; a
client-claimed total is stored as audit-only and never trusted. Orders follow
`draft → confirmed → created → approved → captured | cancelled` with distinct human
confirmation, simulated buyer approval, and a capture step that is **idempotent**: clicking
capture again returns the same stored capture id instead of charging twice. Illegal transitions
(e.g. capture after cancel) return HTTP 409 and are shown in the UI, not swallowed.

## How we built it

Node 22 built-ins only — `node:http` and `node:sqlite`, zero npm dependencies, binds 127.0.0.1.
The payment layer is an adapter interface: a MOCK adapter that reproduces the PayPal Orders v2
state machine offline, and a PayPal Sandbox adapter (client_credentials, Orders create/approve/
capture) that is off unless credentials are explicitly configured. A per-order serial lock
guarantees the adapter is called exactly once even under concurrent duplicate captures, and
every transition is written to the SQLite event log.

## Challenges

The interesting bugs were all about trust boundaries: client-supplied totals, silent quantity
clamping, ambiguous substring matching ("notebook" vs "laptop notebook"), duplicate adapter calls
under a double-click, unescaped output, and origin checks. Each one now has a regression check
that asserts the observable behavior — 151 local checks across five suites.

## What we learned

Probabilistic suggestion and deterministic validation have to be different components with
different permissions. A model that can only *propose*, plus a state machine that can only
*advance on evidence*, is testable in a way that a single "AI does checkout" flow is not.

## Honest limits

This is an educational sandbox, not a payment product: no real funds, no PCI scope, no
multi-user load testing. The Naive Bayes model is a teaching toy, not a measured classifier, and
its scores are not calibrated probabilities. The PayPal Sandbox path was verified end-to-end once
(order `2UV73710NH840425B`, capture COMPLETED, recorded in STATUS.md); the video deliberately
shows MOCK mode so that no credentials or tokens appear on screen.

## What's next

Classroom usability testing, more teaching examples and accessibility work; an optional hosted
model once its cost and privacy conditions are clear.

Full source, tests and the AI-usage disclosure: https://github.com/gfdy22888-design/paymate-sandbox
```

## Field: "Built with" tags (comma-separated)

```
node.js, javascript, sqlite, paypal, paypal-orders-v2, naive-bayes, ai, machine-learning, education, http
```

---

## Pre-submit checklist (verify in this order)

- [ ] Video uploaded to YouTube and set to **Public** (not Unlisted) — hard requirement
- [ ] Video is under 3:00 (current cut: **2:50**)
- [ ] Repo is public and the **LICENSE (MIT) is visible in the GitHub About section** — this is an
      explicit rules requirement; confirm the badge shows, not just the `LICENSE` file
- [ ] GitHub Actions run for latest commit `a181eb4` is green (old green runs don't count)
- [ ] Devpost account logged in, eligibility (age of majority, country) confirmed
- [ ] Official Rules accepted on the Devpost form — legal agreement, must be the participant
- [ ] "Tools" field filled (PayPal Orders v2 + local Naive Bayes + agent-built disclosure)
- [ ] Optional: keep `submission/` docs in the repo (fine to leave public)
