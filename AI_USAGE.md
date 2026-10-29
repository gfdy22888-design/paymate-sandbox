# AI_USAGE.md — 如实 AI 使用披露

**披露日期**: 2026-10-30 (Asia/Singapore)
**项目**: PayMate Sandbox（离线 MVP，含本轮安全/并发修复）

## 实际使用的工具

| 工具 | 角色 | 贡献 |
|------|------|------|
| QwenPaw Agent（模型：glm-5.3-flash） | 全部代码与文档编写 | 本仓库全部源码（`server.js`、`lib/*.js`、`test/*.test.js`、脚本）、全部文档均由该 Agent 生成 |
| Codex | 监督、代码审查反馈与公开版本整理 | 阅读实现，指出数量静默截断、并发重复调用、输出转义等问题，要求回归修复；校正公开文档、添加许可证并准备 GitHub 发布 |

## 未使用 / 未发生

- **无人类代码审查**。本轮有 Codex 的 AI 代码审查反馈，不等同人工复核；验证包含三套自动化测试（unit 49 / security 15 / e2e 34，共 98 项断言）、HTTP 冒烟检查与 Agent 操作的浏览器验收。
- **未声称使用未记录工具**。本轮已记录 QwenPaw 与 Codex；不声称使用 GitHub Copilot、Claude 或 Cursor。
- **无人工 review**。不存在"代码经人工审查"的声明；参赛提交时将如实标注。

## 产品内"AI"的边界（重要区分）

本项目产品功能中的"AI"仅指可选意图解析适配器（`lib/adapters.js` 的 `getAiAdapter`），**默认关闭、未调用、未验证**。当前运行的是确定性规则解析（`lib/intent.js`），**不是 AI**。UI 始终标示"离线规则模式"。

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

若用于 PayPal AI Hackathon 提交：以上内容将如实填入 Devpost AI 使用说明；开发期间若新增工具使用，先在此文件追加记录再提交。**不作任何超出本文件的声明。**
