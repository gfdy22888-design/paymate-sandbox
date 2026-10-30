# AI_USAGE.md — Truthful AI usage disclosure

**Disclosure date**: 2026-10-30
**Project**: CheckoutLab (formerly PayMate Sandbox)

## Tools actually used

| Tool | Role | Contribution |
|------|------|------|
| QwenPaw Agent (model: glm-5.3-flash) | Generated the original checkout core, tests and docs | Original source (`server.js`, `lib/*.js`, original tests), original documentation |
| Codex (OpenAI) | Review + educational extension | Reviewed the implementation, identified defects and requested fixes; implemented the local Naive Bayes teaching model, teaching panel, regression checks and submission materials |
| QwenPaw Agent (glm-5.3-flash) | PayPal Sandbox integration verification | Live end-to-end sandbox run on 2026-10-30 (see below); documentation updates |

## Not used / did not happen

- **No human code review.** No person has reviewed the code; verification was automated test suites and agent-run checks only. This is stated as-is in any submission.
- No other AI tools were used beyond those listed above. No "Copilot wrote X%" claims exist.

## Boundary inside the product (important distinction)

The "AI" in the product's features refers only to the optional intent-parsing adapter (disabled by default, never called, unverified). The default intent parsing is a **deterministic rule parser** — not AI. The teaching panel uses a small multinomial Naive Bayes model fitted from 21 explicit synthetic examples — a statistical teaching tool, not an LLM, and it never creates or approves orders.

## Verification record

- 151 local regression checks across five suites (unit / security / e2e / learning / paypal-contract with provider doubles).
- Earlier round: 114 assertions green (unit 49 / security 15 / e2e 34 / HTTP smoke 16), plus browser UI acceptance screenshots.
- One defect found and fixed during testing (post-positioned Chinese quantity words); regression passed.

## Update 2026-10-30: PayPal Sandbox integration verified

QwenPaw Agent (glm-5.3-flash) performed a live end-to-end sandbox run: OAuth token exchange (HTTP 200), `POST /v2/checkout/orders` (PayPal order `2UV73710NH840425B`, USD 21.50), buyer approval completed by the human participant on PayPal's hosted sandbox page (`APPROVED` per `GET /v2/checkout/orders/{id}`), and capture returning `COMPLETED`. The external LLM adapter remains unverified.

## Submission obligations

If used for the PayPal AI Hackathon: the above will be entered truthfully into the Devpost AI-usage fields; any additional tooling used later will be appended here **before** submission. No claims beyond this file.
