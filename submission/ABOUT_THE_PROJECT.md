## Inspiration

Teaching materials about agents rarely show the exact point where a plausible model output
becomes an authorized payment. CheckoutLab makes that boundary a thing you can click, break and
test — with a mock checkout that has real failure cases and no real money or customer data.

## What it does

A tiny multilingual Naive Bayes classifier suggests a product class for a free-text description
and shows its matched features and score separation, or abstains when evidence is thin. Students
can turn a suggestion into an **unconfirmed draft** — the model never submits an order.

A separate, strict rule parser turns free-text input — English or Simplified Chinese, looked up
against a small bilingual term table — into line items and shows **why each item matched**
(which term, at which position).
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
state machine offline, and a PayPal Sandbox adapter (client_credentials, Orders create/approve/capture) that is off unless credentials are explicitly configured. A per-order serial lock
guarantees the adapter is called exactly once even under concurrent duplicate captures, and
every transition is written to the SQLite event log.

## Challenges we ran into

The interesting bugs were all about trust boundaries: client-supplied totals, silent quantity
clamping, ambiguous substring matching ("notebook" vs "laptop notebook"), duplicate adapter calls
under a double-click, unescaped output, and origin checks. Each one now has a regression check
that asserts the observable behavior — 151 local checks across five suites.

## Accomplishments that we're proud of

- **The refusal path is the feature, not an error page.** Ambiguous, negated, unknown and
  oversized inputs each return a specific reason code instead of a guess, and the parser can
  point at the exact characters it matched — that is what makes the boundary teachable.
- **A double-click cannot charge twice.** Capture is idempotent, backed by a per-order serial
  lock; the video shows the second click returning the same stored capture id over HTTP 200.
- **Illegal transitions are visible.** Capture-after-cancel returns 409 in the page instead of
  failing silently, so a student can break the state machine and read what happened.
- **151 local regression checks across five suites**, written against observable behaviour at
  the trust boundaries (client totals, quantity limits, duplicate adapter calls, escaping,
  origin checks), all green before submission.
- **One real PayPal Sandbox run, disclosed honestly.** Order `2UV73710NH840425B` reached
  capture COMPLETED and is recorded in STATUS.md, while the public demo stays in MOCK mode so no
  credential ever appears on screen.
- **Reproducible from a fresh clone.** Zero npm dependencies, Node 22 built-ins only, bound to
  127.0.0.1 — a classroom machine needs no network and no keys.

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
