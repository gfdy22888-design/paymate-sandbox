# AI_USAGE.md — 如实 AI 使用披露

**披露日期**: 2026-10-30 (Asia/Singapore)
**项目**: PayMate Sandbox（离线 MVP，含本轮安全/并发修复）

## 实际使用的工具

| 工具 | 角色 | 贡献 |
|------|------|------|
| QwenPaw Agent（模型：glm-5.3-flash） | 初始结账核心与文档 | 生成初版 mock checkout、严格解析器、订单存储、外部适配器与原有三套测试 |
| Codex | 审查、教学扩展与发布 | 审阅初版并要求修复；实现本地 Naive Bayes 教学模型、教学面板、21 项新增检查和实际 HTTP 演示脚本；整理提交草稿、英文演示材料与公开版本 |

## 未使用 / 未发生

- **无人类代码审查**。本轮有 Codex 的 AI 代码审查反馈，不等同人工复核；当前四套本机回归检查共 119 项。原版另有远程 HTTP 冒烟与浏览器验收；新教学面板未完成浏览器点击验收，不沿用旧截图冒充。
- **未声称使用未记录工具**。本轮已记录 QwenPaw 与 Codex；不声称使用 GitHub Copilot、Claude 或 Cursor。
- **无人工 review**。不存在"代码经人工审查"的声明；参赛提交时将如实标注。

## 产品内"AI"的边界（重要区分）

当前版本新增 `lib/learning_model.js`：用 21 条明确标注的合成教学样例拟合多项式 Naive Bayes，默认可离线运行。它是统计教学模型，不是 LLM，不使用真实用户训练数据，不声称生产准确率，输出不触发订单或支付。订单解析仍由严格规则实现。可选外部 LLM 适配器 `getAiAdapter` 默认关闭、未调用、未验证；两者不可混为一谈。

## 本轮开发中的真实调试记录

- 测试先行暴露并修复的真实缺陷：
  1. `intent.js` 两处正则模板字面量未插值（`${ZH_CLS}` 在斜杠正则中成字面量）→ 数量解析失效；
  2. `Math.min/Math.max` 静默截断数量 → 改为显式拒绝（`INVALID_QTY` / `QTY_EXCEEDS_LIMIT`）；
  3. `extractQty` 不支持后置数量词（"拿铁两个"）→ 修复；
  4. "笔记本和中性笔" 全局 substring 过滤误删"笔" → 改为 longest-match-wins + 同 SKU 跨度去重；
  5. `sameOriginOk` 原实现可被伪造 Host/Origin 对绕过 → 改为 Host 白名单 + Origin 精确匹配；
  6. confirm/capture 无并发锁，adapter 可能被多次调用 → 加每订单串行锁（`withOrderLock`，finally 安全清理）；
  7. mock-approve 页只跳转不改状态 → 改为真实调用 `/approve`；
  8. 前端伪造 `client_total_cents = qty*100` → 改为省略，金额全由服务端计算；
  9. e2e 测试 session cookie 非 32-hex 被新校验拒绝 → 修正测试夹具。
- 每轮修复后回归：三套测试全绿（日志见 `TEST_REPORT.md`）。
- 未进行任何外部联调（无 PayPal sandbox 凭据、未启用 AI 网关）。

## 提交时的后续义务

若用于黑客松提交：如实披露上述工具和分工；参赛者的亲自编码、人工复核、学习收获不得由 Agent 虚构。演示视频若由实际 API 日志渲染，应注明其不是浏览器录屏。开发期间若新增工具使用，先在此文件追加记录再提交。
