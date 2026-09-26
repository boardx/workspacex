---
bundle: board-object-authoring
phase: "19"
covers: [BV04, BV05, BV06]
status: pending
confirmed_by: ""
confirmed_at: ""
---

# 契约束 `board-object-authoring` 设计签核

覆盖意图（派生视图；权威是 frontmatter `covers:`）：

| feature | 能力边界 |
|---|---|
| BV04 | Sticky/Text 直接编辑、五种文字层级、三种 Sticky 形态与 normal/free/auto-height、IME/RTL/长文本 |
| BV05 | 双击/快捷键/Tab 连续创作、严格体验指标、500 张批量、Delete 与基础 Undo/Redo |
| BV06 | Sticky 高频属性、Reaction、Link 与安全 Link Preview、readonly 边界 |

依据：`requirements/02-object-authoring.md` R1–R12、
`requirements/05-collaboration-history.md` R3/R7，以及 ADR-115 与已确认 S01 束。

## 一、材料清单

- ① UI：`ui.md`（8/8 状态截图已齐；主 session 已完成 8 state × 375/768/1280
  共 24/24 组合的响应式与视觉验收，包含 Canvas 绘制、DOM mirror、移动端 editor、
  11 张连续对象以及 resize 长文本与工具条非遮挡复核）。
- ② 用例：`usecases.md`（十组 application operations + 十二个统一失败码）。
- ③ API/协议：本束不新增公开 Object CRUD；扩展 `whiteboard-core` canonical command 判别联合，
  metadata/ACL 继续复用 `packages/contracts/src/whiteboard.ts`。Link Preview 只定义受限 application port，
  若实施时需要新增跨进程 DTO，必须先补 packages/contracts zod 单源与 design delta。
- 支撑·领域模型：`domain.md`（Sticky/Text、CollaborativeText、IME session、Reaction、Link、基础历史；I-1～I-20）。
- 支撑·覆盖证明：`coverage.md`（V1～V7 与 operation 反向检查）。

## ① UI — 人看到的创作体验对不对

请核对：

- [ ] 双击空白和 `N` 是否都应创建 Sticky 并直接显示 caret；`T` 是否直接创建 Text。
- [ ] TTFI 的口径是否接受为 `board-state-ready → 第一张 caret-ready <5s`。
- [ ] 连续创作是否明确为“第一张之后再创建 10 张”，总数至少 11，首张完成到第 11 张 `<30s`。
- [ ] `Tab` 横向默认、明确纵向序列时纵向、world-space 24px；IME composition 中输入法优先。
- [ ] Sticky square/rectangle/circle 与 normal/free/auto-height 的工具条/属性面板分工是否清楚。
- [ ] Delete 只有 canonical tombstone 确认后才消失，Undo 恢复相同 object id；冲突不得假成功。
- [ ] Reaction 与 Link Preview 的 ready/failed/blocked/readonly 状态是否满足可发现性和无障碍。

当前 8/8 新增状态截图已齐，且来自本束真实 Fabric.js 原型与 mock command adapter；
主 session 已完成 24/24 响应式组合及最终视觉复核。材料已具备人类核对条件，
但 ① UI 仍须由人类确认；截图与自动验收不构成 agent 代签，也不证明正式 Yjs/服务端实现完成。

## ② 用例 — command、IME 与基础历史边界对不对

请核对：

- [ ] React inline editor/Fabric Textbox 都只做短生命周期投影，文本唯一事实是 Y.Text/领域 splice。
- [ ] composition 未结束时 0 splice、0 下一张 Sticky、0 history item；结束时最多一个语义文本项。
- [ ] bulk 500 是一个原子 transaction/history item，任一错误整批拒绝。
- [ ] 基础 Undo 仅覆盖当前在线 authoring scope，不覆盖他人后续写入；BV22 再扩展协作/离线 restore。
- [ ] Commenter 在本束是否允许 Reaction：当前设计默认不允许，若放开必须做 ACL delta，不能只放按钮。
- [ ] Link Preview 是否接受服务端受限 fetch、revision guard、失败保留普通链接的策略。
- [ ] 十二个错误是否足够驱动 UI，且不把内部网络/权限事实泄露给未授权用户。

## ③ API/协议 — 是否接受不新增公开 Object CRUD

请确认：

1. BV04–BV06 只扩展 `whiteboard-core` command/Yjs schema；Web、未来 AI/API/importer 共用，不能各写一套对象 DTO。
2. `CollaborativeText` 用 splice/CRDT，不用整段 LWW string 覆盖并发文字。
3. Fabric scale、class、JSON、React editor draft、DOM reaction 与远端 preview HTML 均不得进入 canonical payload。
4. Link Preview resolver 的网络能力在 infrastructure，经 application port 返回安全字段；浏览器不直接抓任意 URL。
5. 如果实现需要对外 HTTP operation 或独立 Preview API，必须先新增 zod schema、错误信封、ACL/限流与 OpenAPI 消费点，再走 design delta。

## 待人类明确的四个裁决

1. Commenter 是否可以添加 Reaction；当前保守契约为不允许。
2. 空白新 Sticky 在 editor blur 且文本为空时，是保留空对象还是 tombstone；当前材料未替人类决定。
3. `Escape` 在 composition 已结束但 command 尚未确认时，是等待确认还是提示后退出；不得丢字。
4. Link Preview 的组织级 allow/deny policy 是否在 V0.1 暴露管理 UI，还是只由平台策略提供。

## 人类确认动作

本束当前 `status: pending`。① UI 的 8/8 材料与主 session 验收已齐，现在等待人类依次核对
① UI、② 用例、③ API/协议，并把本束加入阶段 `design-coherence.md` 做跨束复核。只有人类可以把 frontmatter 改为
`confirmed` 并填写 `confirmed_by`、`confirmed_at`；agent 不得代签。
