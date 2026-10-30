# TEST_REPORT.md — Real test execution log

**Date**: 2026-10-29 19:47 UTC (= 2026-10-30 03:47 Asia/Singapore)
**Environment**: Node v22.23.4 / Python 3.11.17 / Linux x86_64

> Note: the test inputs below intentionally include Chinese shopping phrases — bilingual intent parsing is a product feature, and the assertions verify that behavior. English-only inputs are covered in the same suites.

===== unit =====
(Use `node --trace-warnings ...` to show where the warning was created)
PASS  intent "我要 2 杯拿铁和 1 个笔记本" -> ok
PASS  intent "2 notebook and 1 pen" -> ok
PASS  intent "拿铁两个" -> ok
PASS  intent "两杯拿铁" -> ok
PASS  intent "拿铁 x3" -> ok
PASS  intent "two latte" -> ok
PASS  intent "笔记本和中性笔" -> ok
PASS  intent "拿铁和绿茶" -> ok
PASS  intent "3 杯绿茶和 2 支中性笔" -> ok
PASS  intent "一个马克杯" -> ok
PASS  intent "拿铁，绿茶，浓缩咖啡" -> ok
PASS  intent "拿铁 x100" -> unresolvable
PASS  intent "拿铁 x0" -> unresolvable
PASS  intent "拿铁 x-1" -> unresolvable
PASS  intent "拿铁 1.5" -> unresolvable
PASS  intent "100 拿铁" -> unresolvable
PASS  intent "1000 拿铁" -> unresolvable
PASS  intent "拿铁x100" -> unresolvable
PASS  intent "不要拿铁" -> unresolvable
PASS  intent "拿铁或者绿茶" -> unresolvable
PASS  intent "拿铁和火箭" -> unresolvable
PASS  intent "laptop notebook" -> unresolvable
PASS  intent "抹茶" -> unresolvable
PASS  intent "来点好吃的" -> unresolvable
PASS  intent "" -> unresolvable
PASS  intent "拿铁" -> ok
PASS  no silent clamp (x100 -> error, not 10)
PASS  x0 -> INVALID_QTY
PASS  total 2 latte + 1 notebook = 2150
PASS  catalog rejects float qty
PASS  catalog rejects unknown sku
PASS  order created draft
PASS  cross-session getOrder null
PASS  draft->captured illegal
PASS  capture not idempotent from draft
PASS  approved->captured ok
PASS  captured->captured idempotent re-read
PASS  capture result stored
PASS  captured->cancelled illegal (terminal)
PASS  concurrent confirm: adapter.createOrder called exactly once
PASS  concurrent confirm: 1 ok + 2 idempotent/illegal
PASS  concurrent capture: adapter.captureOrder called exactly once
PASS  all capture responses share one capture_id
PASS  event log: exactly one approved->captured
PASS  cancel/capture race: serial lock -> single terminal state
PASS  loser of race saw blocked/illegal or idempotent state
PASS  adapter failure surfaces error
PASS  order stays draft after adapter failure
PASS  retry after failure succeeds

=== 49 passed, 0 failed ===
===== security =====
(Use `node --trace-warnings ...` to show where the warning was created)
PASS  malicious Host rejected (403)
PASS  good Host + evil Origin rejected (403)
PASS  good Host + good Origin accepted
PASS  malformed session cookie -> 400
PASS  invalid JSON -> 400
PASS  oversized body -> 413/destroyed
PASS  qty=true rejected (400)
PASS  qty="2" rejected (400)
PASS  qty=1.5 rejected (400)
PASS  qty=null rejected (400)
PASS  client rationale not persisted
PASS  order page served as text/html
PASS  order page escapes via client-side textContent (no server-side injection of raw rationale)
PASS  mock-approve rejects malicious order param (400)
PASS  bad order id page -> 404 (route regex rejects, no echo)

=== 15 passed, 0 failed ===
===== e2e =====
PASS  catalog returns 7 SKUs
PASS  intent zh: 2 latte + 1 notebook
PASS  intent en: 2 latte + 1 notebook
PASS  intent zh numeral: latte x2
PASS  intent unknown -> unresolvable (no guess)
PASS  intent empty -> unresolvable
PASS  ambiguity: notebook only (笔 substring dropped)
PASS  order created (201)
PASS  server recomputed total = 2150
PASS  tampered client total ignored (server price wins)
PASS  tamper evidence stored (client_total_cents=1, total=450)
PASS  float qty rejected
PASS  qty=0 rejected
PASS  negative qty rejected
PASS  qty>10 rejected
PASS  unknown SKU rejected
PASS  order total qty > 20 rejected
PASS  cross-session GET rejected (404)
PASS  cross-session confirm rejected (404)
PASS  cross-session events rejected (404)
PASS  confirm: draft->created via MOCK create
PASS  adapter label MOCK
PASS  capture before approve rejected (409)
PASS  approve: created->approved
PASS  capture ok -> captured
PASS  repeat capture idempotent (same capture_id, idempotent flag)
PASS  cancel after captured rejected (409)
PASS  cancel after confirm works
PASS  capture after cancel rejected (409)
PASS  concurrent captures all 200
PASS  concurrent capture -> single capture id (or idempotent no-op)
PASS  event log: exactly one approved->captured transition
PASS  confirm after captured rejected (409)
PASS  cross-session capture still rejected

=== 34 passed, 0 failed ===
===== HTTP smoke (16/16) =====
Python urllib smoke against live server (127.0.0.1:8787): 16/16 PASS
(GET / 200, catalog 200, intent ok, ambiguous 422, order 201 total 2150,
 qty=true 400, unknown sku 400, confirm 200, capture-before-approve 409,
 approve 200, capture 200, idempotent same capture_id, events audit,
 cross-session 404, evil origin 403)

===== UI acceptance (browser tool, real screenshots) =====
- Home -> intent "我要 2 杯拿铁和 1 个笔记本" -> order page auto-redirect, total $21.50
- Confirm -> created (MOCK-PAYPAL-...) -> Approve -> approved -> Capture -> captured
- Re-click capture -> still captured (idempotent)
- "拿铁或者绿茶" -> explicit rejection message; "不要拿铁" -> NEGATION_UNSUPPORTED
- Screenshots: ui_captured_order.png, ui_ambiguous_rejected.png, ui_negation_rejected.png

===== Totals =====
unit 49 PASS / security 15 PASS / e2e 34 PASS / smoke 16 PASS = 114 assertions, 0 failures
