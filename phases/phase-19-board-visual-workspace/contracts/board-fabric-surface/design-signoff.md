---
bundle: board-fabric-surface
phase: "19"
covers: [BV01, BV02, BV03]
status: pending
confirmed_by: ""
confirmed_at: ""
---

# 契约束 `board-fabric-surface` 设计签核

覆盖意图（派生视图；权威是 frontmatter `covers:`）：

| feature | 能力边界 |
|---|---|
| BV01 | 全屏 Fabric surface lifecycle、viewport、选择与正式路由替换 |
| BV02 | Yjs/whiteboard-core → Fabric/DOM 的按 id 增量 projection registry |
| BV03 | Fabric event → Board command、projection echo suppression 与 accessibility mirror |

依据：`requirements/01-fabric-surface.md` R1–R12、
`requirements/08-performance-accessibility.md` R3/R7/R8，以及 ADR-115。

## 一、材料清单

- ① UI：`ui.md`（1 张真实 Fabric 浏览器截图；七态与正式 Yjs 接线缺口已逐条列出）。
- ② 用例：`usecases.md`（六个 application operations + 统一失败枚举）。
- ③ API/协议契约：现有 metadata HTTP 单源 `packages/contracts/src/whiteboard.ts`；本束不新增
  对象 CRUD，内容写入边界是 `whiteboard-core` command + Yjs transaction，形状与归属在
  `usecases.md`“对外契约位置与边界”列明。
- 支撑·领域模型：`domain.md`（I-1～I-14）。
- 支撑·覆盖证明：`coverage.md`（V1～V7 双向核对）。

## ① UI — 人看到的界面对不对

请核对：

- [ ] 全屏信息层级是否成立：Fabric 中央画布、左侧一级工具、顶部上下文工具、右侧属性/对象大纲、底部 viewport。
- [ ] 对象本体、命中、框选、控点与变换全部由 Fabric 负责；React DOM 仅负责产品外壳和可访问镜像。
- [ ] `/studio/board/:boardId` 是否应完全替换旧 DOM/SVG 主表面；迁移开关只限开发对照且不能形成第二写模型。
- [ ] 5%–800% zoom、fit selection/board、viewer 只读以及 context recovering 的可见形态是否清楚。
- [ ] `ui.md` 列出的七态与 accessibility 缺口必须先补材料，还是允许把它们拆成后续 design delta。

当前截图只是 default mock，且页面自己明确标注未接 Yjs/服务端。确认视觉方向不等于确认实现完成。

## ② 用例 — application ports 与失败模式对不对

请核对：

- [ ] `dispatchBoardCommand` 的“一完整手势最多一 transaction”是否符合协作和 undo 粒度预期。
- [ ] 所有视觉结果都必须经 Yjs observer 回投影，是否接受由此带来的 adapter/测试复杂度。
- [ ] 单坏对象应隔离占位、整板继续可编辑；context lost 才允许从 Y.Doc 全量重建。
- [ ] viewer 的导航/阅读/选择保留，但控点、快捷键、adapter 三条写入口全部拒绝。
- [ ] 幂等键 `(boardId, clientId, gestureId)` 与远端删除后的 selection/focus 恢复语义是否完整。
- [ ] 八个失败码是否足够区分用户可恢复动作，又没有泄露 Board 是否存在。

## ③ API/协议 — 单一事实源与序列化边界对不对

本束没有新增公开对象 CRUD。请确认四层边界：

1. `packages/contracts/src/whiteboard.ts` 只负责 Board metadata、ACL 与成员操作；PG 不保存对象 JSON。
2. Board object/command/patch/transaction origin 的可执行单源属于 `whiteboard-core` + Yjs collaboration protocol。
3. Fabric 只持有可丢弃的进程内 projection；Fabric JSON、class/schema、实例引用、数组下标均不得跨越 adapter。
4. viewport/selection 是客户端交互状态；后续 presence 只能投影摘要，不能把它提升成对象内容。

若人类要求 S01 同时提供公开 operation API，必须先补对应 zod schema、错误信封和 HTTP/OpenAPI 消费点，
再签本束；不能把内部 renderer event 直接暴露为 API。

## 人类确认动作

本束当前 `status: pending`。请先核对 ① UI、② 用例、③ API/协议，再核对阶段根
`design-coherence.md` 的交叉约束。只有人类可以把 frontmatter 改为 `confirmed` 并填写
`confirmed_by`、`confirmed_at`；agent 不得代签。
