# Demo scripts

Current educational demo: `node demo/run_demo.js demo/api-trace.json`, then optional `python demo/build_video.py` using Pillow and imageio-ffmpeg on a development machine. `demo/checkoutlab-demo.mp4` is a 96-second captioned walkthrough rendered from the actual API trace, with `demo/CAPTIONS.en.srt`. It is not a browser screen recording; no payment or external LLM call is real. A YouTube/Vimeo upload and event-specific checks remain pending.

## Historical 3-minute mock-checkout browser script

> Prerequisites: `bash start.sh`, open http://127.0.0.1:8787 . The UI banner always shows the current mode (offline rule mode / MOCK payment, or PayPal Sandbox when credentials are configured).

## 0:00–0:20 Problem statement
- Narration: natural-language ordering is nice, but "AI misreads intent and charges your money" is unacceptable.
- Show the homepage banner: **AI proposes, human confirms, the system double-checks.**

## 0:20–0:50 Intent parsing (happy path)
- Type: `2 lattes and 1 notebook` (or the Chinese equivalent) → click **Parse intent**.
- Auto-redirect to the order page: SKU-LATTE×2 ($4.50) + SKU-NOTEBOOK×1 ($12.50), total **$21.50 (server-authoritative)**.
- Point out the "Why matched" column: keyword/position matches, not a black box.

## 0:50–1:20 Amounts cannot be trusted + no guessing
- Narration + screen: every amount is recomputed server-side in integer cents; client-claimed totals are audit-only.
- Back home, type an ambiguous input → the UI explicitly reports "Cannot determine intent" with a reason. **The system never guesses.**
- Type a negation → `NEGATION_UNSUPPORTED`; type an oversized quantity → rejected with **no silent clamping**.

## 1:20–2:00 Human confirmation → approval → capture
- Back on the order page, click **Confirm order (human confirmation)** → status draft → created, payment order `MOCK-PAYPAL-...` (or a real sandbox order id).
- Click **Simulate buyer approval (mock approve)** → approved. (With sandbox credentials: approve on the real PayPal hosted page.)
- Click **Capture payment (mock capture)** → captured, green "✅ Captured".

## 2:00–2:30 Idempotency + cancel + audit
- Click **verify idempotency** again → still captured, same capture id.
- Start a new order up to created, click **Cancel** → cancelled (terminal); clicking capture afterwards → 409 rejection.
- (Narration) every transition is written to the SQLite event log; a per-order serial lock guarantees the adapter is called exactly once under concurrent duplicate captures.

## 2:30–3:00 Technical highlights & honest disclosure
- Node 22 built-ins (http + node:sqlite), zero npm dependencies; Orders API v2 flow + client_credentials server-side auth; secrets never leave the server.
- The AI and PayPal Sandbox adapters are **off by default** and the public demo runs MOCK; the PayPal Sandbox route is verified (see STATUS.md), the external LLM route is not.
- AI disclosure: see `AI_USAGE.md` for the full, truthful record.

## Recording checklist (todo)
- [ ] Screen-record + upload publicly to YouTube (required submission material)
