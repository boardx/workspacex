---
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: canvas-template-recommendations
base_bundle: canvas   # 模板注册表那一束；chat 侧新增的只读操作挂在同一 delta 里
scope: recommend-after-column-plus-three-tier-fallback-plus-admin-picker
covers: []
confirmed_by: null
confirmed_at: null
confirmed_via: null
---

# design delta 签核 · chat 建议行按上下文推荐后台画布模板

⚠ `status`、`confirmed_by`、`confirmed_at` 只能由人类修改；agent 不代签（ADR-023 / AGENTS.md
「设计签核（三件、一处签）」）。

规范唯一来源：[`contract.md`](./contract.md)。验收口径：[`verification.md`](./verification.md)。
GitHub：issue #2825，PR #2832（主功能）/ #2846（两条实测反馈的修复）。

## 这份 delta 为什么存在，以及它为什么是**补**的

人类 2026-09-06 当面交办、当日实现、当日两轮实测反馈并口头确认「维持现状」。实现已经
合入 main——这不符合「feature 开工前先签核」的正常次序，属于 `suggestTemplateSections` /
#496 / #988 那一类「人类当面交办、实现先行、登记待补签」的先例。

⚠ 本文件是那次口头确认的**机械记录处**。此前 agent 曾把「已人类签核」直接写进
`packages/contracts/src/chat.ts` 的注释里——那是错的：唯一的签核门是这份 `design-signoff.md`，
代码注释不是。（PR #2856 codex review P1 逐字指出，属实；那次改动已回退成"待补签"，
并改为指向本目录。）

## ① UI

请看 [contract.md](./contract.md) §4，以及真实截图两处（人类已在实测中看过）：

- **chat 建议行**：chip 文案直接用后台配的 `displayName`；一次最多 3 条，与 CopilotKit
  的模型追问建议并排；每条可单独关闭（按线程 + 模板 key 记住）。
- **后台编辑器「用完之后推荐」**：只显示已选中的几条（顺序即优先级，× 移除），未选的收进
  「＋ 添加」浮层（搜索 + 限高滚动）。第一版摊开整库，人类实测原话「不要摊开所有的
  chips，占用的空间太大了，你要知道有可能会有 50 个 chips」。

重点确认：3 条这个数是否合适（契约上限 4，见 contract.md §5②）。

## ② 用例

请看 [contract.md](./contract.md) §2 的三梯队表与 [verification.md](./verification.md)
V1–V3，重点看**边界是否穷举**：

- 线程里一个画布都没有 ⇒ 推起点模板；
- 画过的模板没配任何推荐关系（组织自建的真实形态）⇒ 仍然给得出下一步（V2）；
- 库里每一张都画过了 ⇒ 返回空，不推荐一件刚做完的事（V3）；
- `recommendAfter` 指向已归档/不可见/不存在的 key ⇒ 安静跳过，不产出假 chip（V4）。

## ③ API 契约

请看 [contract.md](./contract.md) §1 §3，对应 `packages/contracts/src/`：

1. `canvas.updateTemplateMetadata` 收/回 `recommendAfter`，`listTemplates.out` 带上它——
   与 title/footer/promptText 同类的元数据，对任何状态生效、碰不到 `sections`；全量替换。
2. `chat.recommendCanvasTemplates`（`GET /chat/threads/:threadId/canvas-template-recommendations`）：
   只读、不调模型、不写库；`out.items` 上限 4；模板库读不到返回空 `items` 而非报错。
3. `recommend_after` 列**不加外键**（理由见 contract.md §1）。

## 请人类拍板的两处取舍

见 [contract.md](./contract.md) §5。人类 2026-09-06 在会话中口头选择了**维持现状**
（三梯队兜底 + 一次 3 条），被否掉的替代方案是「没配过就不推」。本文件把那次口头选择
落成可核对的记录——**改 `status: confirmed` 仍然是人类的动作**。

## 与既有已签内容的关系

- **不修订** delta `chat-persona-roundtrip`：`summarizePersonaFromThread` 的行为一行没改，
  `persona` 那条 chip 仍然走它（contract.md §4）。本 delta 只是把「谁能进建议行」从一条
  写死的常量换成后台可配的推荐图。
- 复用 issue #1493 的 canvas 围栏语法与 system prompt 指引，**不新增**第二套格式约定。
