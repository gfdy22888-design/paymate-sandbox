# Educational extension acceptance — 2026-10-30 Asia/Shanghai

## Verified on the local development machine

Node v22.22.2 on submission day (an earlier acceptance run used v24.19.0), Windows. Suites ran sequentially: unit 49/49; security 15/15; e2e 34/34; learning model/API/UI logic 24/24; mocked Sandbox boundary 29/29. Total: 151 passing checks. The fixture phrases exercise model inference and abstention but are not a statistical evaluation dataset or a real-world accuracy benchmark. Provider contract doubles make no real PayPal requests and do not establish live integration.

`demo/api-trace.json` was produced by executing `node demo/run_demo.js` against the real local HTTP server with a fresh temporary SQLite database. It records model metadata, a suggestion, abstention, ambiguous-input rejection, server-side price recomputation, illegal early capture, mock confirmation/approval/capture, idempotent repeated capture and the event trail. The script fails if the expected amount, transition or capture identity is incorrect and closes its server in `finally`.

The trace's RSS value is one observed local Node process snapshot (58.5 MiB in this run). It is not a whole-VPS reading, peak bound, or assurance that a machine with 100 MiB free can safely run a browser/agent stack.

## Not verified / not claimed

- The new learning panel has API, generated-JavaScript compilation and VM-executed UI-logic checks. Choosing a model suggestion creates only a draft; it does not approve payment. A 2:50 browser screen recording of the checkout flow was completed on 2026-10-30 (https://youtu.be/_OxAlKRfZ7I, Public); it does not cover the teaching panel. The teaching panel was separately clicked through in a real browser on 2026-10-31: `milk coffee` returned a suggestion (SKU-LATTE, matched features `milk`/`coffee`, caveat text shown) and the suggestion button produced a **draft** order (`PM-MVV7T4RX-Q0GRZ6`, status `draft`, still awaiting "Confirm order"); `purple unicorn` returned `abstain / INSUFFICIENT_EVIDENCE` with no draft button; `no latte` made the model abstain and the strict parser reject it as `NEGATION_UNSUPPORTED (no)` inline. No defect was found.
- Earlier UI screenshots and the 16-check remote smoke test validate the earlier checkout release, not the new learning panel. The recording above validates the checkout flow end to end in a real browser (home page, parse, order page, mock approval, capture, idempotent replay, cancelled-order 409).
- Optional routes are off by default. PayPal Sandbox was verified end-to-end once (2026-10-30, order `2UV73710NH840425B`, capture COMPLETED — see STATUS.md); the external LLM route remains unverified.
- GitHub CI: the `tests` workflow completed **success** on `c552b3b` (2026-10-30), the commit that carries these acceptance notes. Any later push needs its own green run.
- Registration, rule acceptance, public YouTube upload and Devpost submission were completed on 2026-10-30 (https://devpost.com/software/checkoutlab-human-confirmed-ai-checkout). No live Demo Day gate exists in this hackathon's published rules: judging is asynchronous over the Judging Period 2026-12-01 to 2026-12-15, winners announced on or around 2026-12-21. The Demo Day notes elsewhere in `submission/` belong to the earlier STEM2Connect path and do not apply to this entry.
