# STATUS.md — CheckoutLab（2026-10-30 Asia/Shanghai）

## 当前教学扩展

- 本地 Naive Bayes 教学模型、教学面板、实际 API 演示脚本已实现；四套本机回归检查 119/119 通过。
- 当前目标为教育方向；默认路径不依赖 PayPal 或外部模型 API。外部接口仍禁用且未联调，不能冒充验证完成。
- 参赛者的概况已私下提供；已按公开年龄/在校条件核对。身份信息不写入公开仓库，平台及其他资格声明须如实完成。
- 已准备英文 Devpost 草稿与流程清单；演示输出为实际 API 执行轨迹的字幕化视频，不是浏览器录屏。
- 本轮尚未完成新教学面板浏览器点击验收、YouTube/Vimeo 上传、Devpost 报名/条款接受/正式提交或 Demo Day。
- 浏览器操作工具连接断开，不能声称远程 VPS 已完成清理；历史测试服务已报告停止，当前资源余量未核实。
- 新提交的 GitHub CI 需在推送后单独核对，不能使用旧提交的成功记录代替。详见 submission/ACCEPTANCE.md。

## 以下为原版 PayMate Sandbox 验收历史（不代表新面板已浏览器验收）

## 状态总览

| 类别 | 状态 |
|------|------|
| 离线 MVP（规则解析 + MOCK 支付全链路） | ✅ 已完成并验证 |
| 自动化测试 | ✅ 114 断言全绿（unit 49 / security 15 / e2e 34 / HTTP smoke 16） |
| 浏览器 UI 全链路验收 | ✅ 已实跑并截图（ui_*.png 3 张） |
| PayPal Sandbox 适配器 | ⚠️ 代码就绪、**未联调**（无凭据） |
| AI 适配器（WorkBuddy Gateway） | ⚠️ 代码就绪、**未启用未验证**（额度待确认） |
| 参赛就绪 | ❌ 未就绪（见下） |

## 已验证（有真实执行证据）

- 中英文意图解析（前置/后置数量词、中文数字、英文数字、x2 后缀、多商品）
- 明确拒绝：0/-1/1.5/100/1000、x100、"不要拿铁"、"拿铁或者绿茶"、"拿铁和火箭"、"laptop notebook"、"抹茶"（不偷换绿茶）、静默截断已移除
- "笔记本和中性笔" 两商品均保留（longest-match-wins）
- 金额服务端分制重算；`client_total_cents` 仅审计不被信任；qty 强类型（true/"2"/1.5/None 均 400）
- 状态机 draft→confirmed→created→approved→captured/cancelled；非法迁移 409；终态锁定
- 每订单串行锁：并发 confirm/capture 下 adapter 恰好调用 1 次、同一 capture_id、事件表恰好一次迁移
- cancel/capture 竞争收敛到单一终态；adapter 故障后订单保持 draft 可重试
- 跨会话隔离（404）；Host 白名单 + Origin 精确匹配；非法会话格式/JSON 拒绝；超大请求被限制（可能直接断开连接）
- client rationale 不持久化；前端转义或 textContent 渲染；mock-approve 参数白名单校验
- UI：完整下单流 + 幂等重按 + 歧义/否定拒绝消息（截图为证）

## 未验证（明确不算）

- PayPal Sandbox 真实调用（create/approve/capture 对 api-m.sandbox.paypal.com）
- AI 适配器真实调用（网关额度/收费未确认）
- 多用户并发压力/长稳测试
- demo 视频录制、公开仓库 CI 在真实 GitHub 上的运行

## 参赛未就绪项

1. PayPal sandbox 凭据（用户注册）→ 联调后才能声称集成验证
2. AI 网关额度确认 → 才能启用并验证 AI 路径
3. 资格核验：用户年龄/居住地（PayPal 排除清单）、学籍（备选赛）
4. 录制 demo 视频并上传 YouTube
5. Devpost 账号、对官方条款的接受、最终提交（用户动作）

## Git / GitHub

- 开发环境 Git 提交：`f0c67ed`（MVP）、`c0d01de`（文档）。公开版本另含 Codex 的文档校正与 LICENSE，公开提交历史以 GitHub 为准。
- GitHub Actions 工作流（Node 22 测试）已就位 `.github/workflows/test.yml`
- 公开仓库：https://github.com/gfdy22888-design/paymate-sandbox 。README 中的公开说明不代表已报名或提交比赛；CI 运行结果以 GitHub Actions 为准。

## 边界声明

本轮未注册参赛账号、未接受比赛条款、未报名或提交、未发生真实付款、未建立定时任务；源码按用户要求准备公开发布。测试服务仅绑定 127.0.0.1，验收后已停止。
