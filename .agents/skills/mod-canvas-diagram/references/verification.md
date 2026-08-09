# 验证 — 怎么验证一个 canvas 改动是对的

## 两层测试，运行环境不同，不要混着改一层期待另一层跑

### 1. `packages/fabric-markdown` 自身的单测（vendored 上游 + 本仓改动）

```bash
pnpm --filter @repo/fabric-markdown exec vitest run
```

222+ 个上游单测（`packages/fabric-markdown/tests/*.test.ts`），jsdom 环境，覆盖
13 种 mermaid 图的解析/序列化几何提取、UML 类关系、模板引擎 round-trip
（`roundtrip-guard.test.ts`）等。**这些测试逐字来自上游**（ADR-100 决策一），
"不改一行"，改动前先确认改的是不是本仓专属新增（如 `templates-entry.ts`）。

### 2. `apps/api/tests/canvas/`（本仓契约层，19 个测试文件）

```bash
pnpm --filter api exec vitest run tests/canvas
```

覆盖服务端持久化的画布模板/绑定/便签 LWW/组状态等，测试文件名本身就是 UC 描述：

- `roundtrip-13-mermaid-diagrams.test.ts`（F103）—— 13 种图各一份夹具，纯函数层
  （`modelToMermaid`/`wrapAsMermaidBlock`/`extractMermaidBlocks`），**在 Node 里
  跑，不需要浏览器**——因为它只测"model → 文本"这个方向，不需要
  `mermaid.render()`。
- `coords-not-written-back.test.ts`（F104，标注 `@vitest-environment jsdom`）——
  从一份"已解析好的 DiagramModel"起步（等价于"真实浏览器已经把 mermaid 解析成
  模型"），覆盖 `DiagramModel ⇄ fabric ⇄ mermaid ⇄ Markdown` 这几段，用
  `fabric.StaticCanvas` 在 jsdom 下真实运行（不 mock）。
- `binding-uses-key-not-displayname.test.ts`（F100）—— `key`/`displayName` 边界。
- `sticky-lww-and-group-status.test.ts`（F105）—— 便签级 LWW + 组画布状态 enum。
- 其余：`ava-badge-atomic-rollback` / `backflow-source-chain-unbroken` /
  `bind-template-to-segment-http` / `conflict-bar-three-exits-keep-both` /
  `create-template-http` / `mermaid-whitelist-ignored-count` /
  `only-lead-confirmed-writeback` / `persona-summary-no-fabrication` /
  `publish-archive-instance-version` / `segment-binding-instantiation` /
  `segment-two-template-limit` / `sticky-geometry-region-roundtrip` /
  `structural-vs-sticky-decision-table` / `template-lifecycle-http` /
  `template-registry-19-key-displayname` / `three-way-transform` /
  `whitespace-rules-warn-not-block`。

## mermaid 真实渲染（浏览器路径）验证不到——如实标注

`mermaid.render()` 依赖 `getBBox()` 做文本测量，**jsdom 不满足这个要求**
（`roundtrip-13-mermaid-diagrams.test.ts` 文件头已实测确认："jsdom 缺
`getBBox`，`mermaid.render` 内部直接抛错"）。这意味着 `mermaidToModel()`
这个方向（mermaid 文本 → DiagramModel，含真实渲染几何抽取）**没有自动化单测
覆盖真实渲染路径**，只能靠人工/E2E 在真实浏览器里验证。改 `mermaid-parser.ts`
里依赖渲染 SVG 的部分（`extractNodeGeometry`/`extractClusterGeometry`/
`extractSequenceGeometry` 之外的、直接调 `mermaid.render()` 的 `mermaidToModel`
本体）时，不要以为 vitest 全绿就等于这条路径没坏。

## typecheck / lint

```bash
pnpm --filter @repo/fabric-markdown exec tsc --noEmit
pnpm --filter api exec tsc --noEmit   # 或仓库根 pnpm exec tsc --noEmit -p .
```

`packages/fabric-markdown` 的 lint 是空操作（`echo` 占位）——上游源码风格不改写
（ADR-100 决策一负面清单），契约层面的检查全部在 `apps/api` 的 canvas 契约测试。
