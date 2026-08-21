# chat 图表消息只读预览接引用解析（issue #1668）· 可执行验收契约

零契约改动、零后端改动——本 delta 只改前端两个组件（`ChatDiagramFabric`/
`ChatCanvasFabric`）新增一条挂载即读回的 effect，复用 G1
（`chat-persona-roundtrip`，confirmed 2026-08-18）已建好的 `fetchLatestSavedDiagramSource`。

## 类型检查

```bash
pnpm --filter web run typecheck
pnpm --filter api run typecheck
```

## 组件级钉死：挂载滚入视口即读回

```bash
pnpm --filter web exec vitest run tests/ui/chat-fabric-auto-readback-on-mount.test.tsx
```

断言：

- 有保存版：挂载即自动查回（不点任何按钮），只读预览校验链路（`mermaid.parse`/
  `checkCanvasFence`）吃到的入参是保存版内容，不是原始 `code`；请求只发一次
  （`savedSource` 拿到值后 effect 依赖不再触发）。
- 无保存版：挂载查一次即可，预览保持原始消息内容，不因为拿到 `null` 而重复请求。
- `threadId`/`messageId`/`bearer` 任一缺失（预览页/流式草稿）：不发任何读回请求，
  与今天完全一致。
- `ChatDiagramFabric`（mermaid 标准图表）与 `ChatCanvasFabric`（工作坊画布模板）
  两个组件对称覆盖。

## 既有回归不破坏

```bash
pnpm --filter web exec vitest run tests/ui/chat-diagram-saved-readback.test.tsx
pnpm --filter web exec vitest run tests/ui/chat-fabric-preview-syncs-after-save.test.tsx
pnpm --filter web exec vitest run tests/ui/chat-diagram-save-gate.test.tsx
```

## 真栈 e2e——直接反证 issue 描述的现象（核心验收线）

```bash
pnpm run verify:chat-read
```

（跑 `apps/web/e2e/chat-diagram-save-reopen-roundtrip.spec.ts` 里新增的用例：
「只读预览挂载即读回：保存后立即可见 + reload 不点最大化也可见（issue #1668）」，
与既有 G1/G2 用例同一个 config、同一个夹具、同一次 webServer 编排，不新增
独立 runner。）

断言（真浏览器 → apps/web → apps/api → PostgreSQL + 对象存储）：

1. 发一条正文含 ```mermaid 围栏的用户消息，等确定性回声上游把它原样回显进
   assistant 消息（`chat-live-message-panel.tsx` 只对 `isAgent` 消息渲染
   `MarkdownMessage`，人类自己发的消息没有 markdown 语义，故用回声上游而非
   直接发 assistant 侧图）。
2. 点「最大化」→ 编辑（加一个节点）→ 保存 → `chat-diagram-saved` 徽章出现 →
   关闭 modal（**不刷新**）：气泡只读预览像素级截图与编辑前的原始版不相等
   （PR #1696 已修的既有行为，本处回归钉死）。
3. **整页 reload**（穿透前端内存态）→ 翻页找到同一条消息 → **不点「最大化」**、
   只是把图滚入视口：
   - 断言一个 `GET .../artifacts/:artifactId/source` 请求自动发出（不是巧合——
     「挂载即读回」那条 effect 真的跑了，不是缓存/热更新残留的假象）。
   - 断言此时只读预览的像素级截图与「步骤 2 保存后不刷新」那次截图**字节级相等**，
     且都与「步骤 1 编辑前」的原始版截图不相等——这正是直接反证 issue 原文
     「刷新页面后，原消息气泡里的只读预览仍是编辑前的内容」的证据。

## 门控汇总

```bash
pnpm exec tsx .harness/scripts/cli.ts doctor
```
