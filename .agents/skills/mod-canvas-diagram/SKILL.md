---
template_id: TPL-MOD-001
template_version: 1
instance_id: MODKNOW-canvas-diagram
skill_id: SKL-MOD-CANVAS-001
domain_id: DOM-CANVAS-DIAGRAM
status: active
name: mod-canvas-diagram
description: >
  Canvas/Diagram Domain 的活知识库：Fabric.js ⇄ Mermaid 转换链（packages/fabric-markdown）、
  画布数据身份、序列化边界、协作现状与已知陷阱。动手改 mermaid 解析/序列化、fabric 画布对象、
  或 apps/api 的 canvas 契约层之前必读。
authority_refs:
  contracts:
    - phases/phase-01-run-a-project/contracts/canvas
    - phases/phase-01-run-a-project/contracts/canvas/domain.md
    - phases/phase-01-run-a-project/contracts/canvas/usecases.md
    - phases/phase-01-run-a-project/contracts/canvas/design-signoff.md
  adrs:
    - docs/adr/ADR-100-fabric-markdown.md
  source_paths:
    - packages/fabric-markdown/src/mermaid-parser.ts
    - packages/fabric-markdown/src/mermaid-serializer.ts
    - packages/fabric-markdown/src/model.ts
    - packages/fabric-markdown/src/canvas-io.ts
    - packages/fabric-markdown/src/connection-manager.ts
    - packages/fabric-markdown/src/fabric-objects.ts
    - packages/fabric-markdown/src/markdown.ts
    - packages/fabric-markdown/VENDOR.md
    - apps/api/src/domain/canvas/sticky-lww.ts
    - apps/api/src/domain/canvas/group-canvas-status.ts
    - apps/api/src/domain/canvas/mermaid-whitelist.ts
    - apps/web/lib/live-canvas.ts
    - apps/api/tests/canvas/roundtrip-13-mermaid-diagrams.test.ts
    - apps/api/tests/canvas/coords-not-written-back.test.ts
    - apps/api/tests/canvas/binding-uses-key-not-displayname.test.ts
    - apps/api/tests/canvas/sticky-lww-and-group-status.test.ts
    - .harness/domains/registry.yaml
  verification:
    - "pnpm --filter @repo/fabric-markdown exec vitest run"
    - "pnpm --filter api exec vitest run tests/canvas"
    - "pnpm --filter @repo/fabric-markdown exec tsc --noEmit"
    - "pnpm harness domains doctor"
last_verified:
  commit: d96cac445f2053abb53dcc2ebf1bef0f3d354fdd
  evidence_refs:
    - "issue #824 (boardx/workspacex) — H3A-018 调研与实现记录"
    - "PR body: pnpm --filter @repo/fabric-markdown exec vitest run 全绿输出"
    - "PR body: pnpm --filter api exec vitest run tests/canvas 全绿输出"
    - "PR body: pnpm harness domains doctor 输出（本实例通过 H3A-013/014/015/016/017）"
---

# Canvas/Diagram（mod-canvas-diagram） — Domain Skill

> 本文件是 `DOM-CANVAS-DIAGRAM` 的**单一经验沉淀点**（TPL-MOD-001 实例，H3A-012 schema）。
> 这是目录页，不是百科全书——六类内容各自的详细版本在 `references/`，按需加载，
> 不要把细节全塞进这个入口文件（H3A-017 体积门，≤150 行）。

## 一句话定位

承载 Mermaid 文本 ⇄ `DiagramModel` IR ⇄ Fabric.js 画布对象这条转换链
（`packages/fabric-markdown`，ADR-100 源码并入的第三方库）以及 `apps/api` 侧
画布模板/绑定/便签级并发写这条服务端持久化层。两层是正交的，见
`references/architecture.md`。

## 六类内容索引

| 类别 | 一句话摘要 | 详细版本 |
|---|---|---|
| 架构 | Markdown⇄mermaid⇄`DiagramModel`⇄fabric 四段转换全在 `packages/fabric-markdown`；`apps/api` 侧只管服务端持久化的模板/绑定，不解析 mermaid | `references/architecture.md` |
| 身份 | 节点/边 `id` 是唯一权威身份，mermaid 顶点 id = `FlowNode.nodeId` = `FlowEdge.source/target`，三种表示不发第二套 id | `references/identity.md` |
| 序列化 | 三种表示（fabric JSON / `DiagramModel` / mermaid 文本）各管一段；**坐标绝不写回 mermaid 文本**（F104 机械钉住） | `references/serialization.md` |
| 协作 | 今天**没有**画布对象层面的实时多人同步（无 WebSocket/CRDT）；真实存在的是服务端便签级 LWW（不弹冲突条）+ 组画布状态轮询 | `references/collaboration.md` |
| 验证 | `packages/fabric-markdown` 自身单测（jsdom）+ `apps/api/tests/canvas` 契约测试（19 个文件）；mermaid 真实渲染路径 jsdom 跑不了，只能人工/E2E | `references/verification.md` |
| 陷阱 | 坐标泄漏回归、`getDiagramFromText` 弃用风险、subgraph 启发式匹配、participant 坐标补偿符号、key/displayName 混用、白名单不删代码块、ADR-100 仍是 Proposed | `references/pitfalls.md` |

## 关键契约与不变量（改代码前必读，展开见对应 reference）

- **坐标不写回 Markdown**（R7 规则②，I-9）：`modelToMermaid` 输出文本永不含
  任何 x/y 数值。详见 `references/serialization.md` 与 `references/pitfalls.md` #1。
- **`key` 是模板身份唯一权威，`displayName` 只在契约层**（ADR-100 决策四，I-3）：
  绑定/实例固化/围栏语法一律用 `key`。详见 `references/pitfalls.md` #5。
- **`fabric`/`mermaid` 锁死到确切版本**，不是 caret（ADR-100 决策二）：升级前必须
  跑完整测试套件并留证据。详见 `references/pitfalls.md` #2。
- **便签级 LWW 不弹冲突条**（F105，I-16/I-19）：被覆盖的修订记历史，不丢内容。
  详见 `references/collaboration.md`。

## 模块 SOP

1. 动手前：读对应 reference 文件 + `phases/phase-01-run-a-project/contracts/canvas/`
   下的 UC/domain 文档；确认改的是 `packages/fabric-markdown`（上游并入，不改风格）
   还是 `apps/api/src/{domain,application}/canvas`（本仓服务端逻辑，正常改）。
2. 开发中：`packages/fabric-markdown` 的改动优先考虑"是否该改上游"（`VENDOR.md`
   回流规程）；`apps/api` 侧改动照常走 `harness verify`。
3. 交付前：跑本文件 `verification` 里列的四条命令；`packages/fabric-markdown`
   涉及的改动额外跑 `pnpm --filter @repo/fabric-markdown exec vitest run`
   （222+ 上游单测，逐字未改不应变红）。

## 踩坑与经验（append-only，最新在上）

- 2026-08-09：本 Skill 首次建立时的调研快照记在 `references/pitfalls.md`；后续
  真实踩坑请在同一 PR/紧随的小 PR 里往该文件追加（不删旧条目，被推翻的标删除线）。

## 知识回流规则

1. **谁干活谁回流**：在本 Domain 交付 feature/修 bug/做 review 时踩到新坑、建立
   新做法、推翻旧假设 → 往 `references/pitfalls.md` **追加**一条
   `- YYYY-MM-DD：一句话结论（出处：PR/issue 链接）`，或对应类别的 reference 文件。
2. `references/` 的其余五类文件同样 append-only 追加式更新；新增章节/重组走正常
   review。
3. `authority_refs`/`last_verified` 随本 Skill 实际验证情况更新，不允许"看起来
   验证过"却没有真实跑过对应命令。
