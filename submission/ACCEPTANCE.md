# Educational extension acceptance — 2026-10-30 Asia/Shanghai

## Verified on the local development machine

Node v24.19.0, Windows. Suites ran sequentially: unit 49/49; security 15/15; e2e 34/34; learning model/API/UI logic 24/24; mocked Sandbox boundary 29/29. Total: 151 passing checks. The fixture phrases exercise model inference and abstention but are not a statistical evaluation dataset or a real-world accuracy benchmark. Provider contract doubles make no real PayPal requests and do not establish live integration.

`demo/api-trace.json` was produced by executing `node demo/run_demo.js` against the real local HTTP server with a fresh temporary SQLite database. It records model metadata, a suggestion, abstention, ambiguous-input rejection, server-side price recomputation, illegal early capture, mock confirmation/approval/capture, idempotent repeated capture and the event trail. The script fails if the expected amount, transition or capture identity is incorrect and closes its server in `finally`.

The trace's RSS value is one observed local Node process snapshot (58.5 MiB in this run). It is not a whole-VPS reading, peak bound, or assurance that a machine with 100 MiB free can safely run a browser/agent stack.

## Not verified / not claimed

- The new learning panel has API, generated-JavaScript compilation and VM-executed UI-logic checks. Choosing a model suggestion creates only a draft; it does not approve payment. No real browser layout/click-through or new browser screen recording was completed because the browser-control connection was unavailable.
- Earlier UI screenshots and the 16-check remote smoke test validate the earlier checkout release, not the new learning panel.
- The optional PayPal Sandbox and external LLM routes remain unverified and disabled.
- GitHub CI for this extension is pending until its commit is pushed and checked; an earlier commit's successful run is not evidence for this extension.
- Registration, rule acceptance, public/unlisted YouTube/Vimeo upload, Devpost submission and Demo Day participation remain separate, uncompleted gates.
