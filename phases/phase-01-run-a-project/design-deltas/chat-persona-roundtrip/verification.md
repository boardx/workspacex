# chat 用户画像生成与图表保存读回闭环（G1+G2）· 可执行验收契约

> 本文件写的是**验收标准**，不是已跑通的证据——G1/G2 草案此刻都停在设计稿，
> `packages/contracts/src/chat.ts` 未被本次任务改动。下面每个命令对应的测试文件
> **目前大概率不存在**，这是预期的 RED——它们要在人类签核后、对应 feature 开工实现时
> 才被创建。

## G1a：`listThreadArtifacts` 条目带 `messageId`

```bash
pnpm --filter api exec vitest run tests/chat/list-thread-artifacts-message-id.test.ts
```

断言（真栈：HTTP → controller → application → repository → PostgreSQL）：

- 先 `landAsArtifact` 落一条 draft，再 `listThreadArtifacts`，对应条目的 `messageId`
  与落地时传入的 `messageId` 逐字相等（来自 `chat_artifact_landings.message_id`，
  不是响应体回显）。
- `out` 的 `safeParse` 通过；反向断言：条目缺 `messageId` 字段的 body 应被 `.strict()`
  schema 拒绝（B-8 规则，覆盖拒绝路径）。

## G1b：`getThreadArtifactSource` 读回

```bash
pnpm --filter api exec vitest run tests/chat/get-thread-artifact-source.test.ts
```

断言（真栈，同上标准）：

- 落地一条含真实 markdown 的 draft 后按 `(threadId, artifactId)` 读回，`markdown` 与
  保存时的字节逐字相等（从对象存储读回，不是从请求缓存回显）；`savedAt`/`savedBy`
  与 landing 行一致。
- 同一消息保存两次 ⇒ 读回**最新**一次的内容（`created_at` 排序断言）。
- 草稿创建者之外的组员读 ⇒ `NOT_VISIBLE`（I-36 同形状，与 `listThreadArtifacts`
  的隐藏语义一致：同一条草稿在 list 里不可见 ∧ source 读不到，两处一致）。
- 不存在的 `artifactId` ⇒ `NOT_VISIBLE`（不区分「不存在」与「不可见」，避免探测）。

## G2：`summarizePersonaFromThread` 产出进线程 + mindmap 围栏

```bash
pnpm --filter api exec vitest run tests/chat/summarize-persona-mindmap-message.test.ts
```

断言（真栈）：

- 线程里种入含 persona 文本语法的消息后触发，`out.resultMessageId` 指向的消息真实
  存在于线程（`listMessages` 重读，不信响应体），角色为 assistant，正文含
  ` ```mermaid ` 围栏且首个非空行是 `mindmap`。
- mindmap 六个一级分支名与 `@repo/fabric-markdown` 的 `PERSONA_SECTIONS` 集合相等
  （逐值点名差集，不用 `toHaveLength`；权威源 import 自 fabric-markdown，不手抄第二份）。
- 空线程触发 ⇒ `sufficient: false`，六分支下是「信息不足」占位节点，**不出现任何
  未在线程正文出现过的实体词**（不编造断言：占位文案是固定字符串，可逐字比对）。
- `out.mode` 恒为 `draft`。

## 前端：触发入口 + 渲染 + 读回提示

> ⚠ **2026-09-03 人类直接指示撤回**：composer 恒定「生成用户画像」按钮（1.1 节
> 候选 A，`chat-live-message-panel.tsx` 的 `chat-persona-summary-trigger`）已移除——
> 人类实测反馈它固定占一整行、常态挂在 composer 左上方，是误操作入口，不是本次
> 签核想要的体验。①/②/③ 三节其余裁决（读回提示条、信息不足占位、mermaid mindmap
> 产出形态、契约字段）不受影响，`summarizePersonaFromThread` 端点本身保留——
> 该测试文件（`tests/ui/chat-persona-summary-trigger.test.tsx`）已随按钮一并删除，
> 相关覆盖（软重读 cursor 不塌回起点）改钉在 `tests/ui/chat-read-screen.test.tsx`
> 的发送消息路径上（同一个软重读触发点，不再借道这个按钮）。**本节命令改为**：

```bash
pnpm --filter web exec vitest run tests/ui/chat-diagram-saved-readback.test.tsx
pnpm --filter web run typecheck
pnpm --filter web run lint:design
```

断言：

- 有保存版时打开 modal：初始内容为保存版 markdown，`chat-diagram-loaded-saved`
  提示条可见；点 `chat-diagram-revert-original` 后编辑区变回原始消息内容。
- 无保存版时打开 modal：无提示条，初始内容为原始消息内容（回归既有行为）。
- `summarizePersonaFromThread` 端点本身仍可用（`tests/e2e/chat-diagram-save-reopen-
  roundtrip.spec.ts` 直连调用产出确定性 mermaid 消息，见下一节）；CopilotKit v2
  面板另有一条独立、按上下文出现的建议 chip 入口（`copilotkit-v2-panel-body.tsx`
  的 `showPersonaSuggestion`，CK-P6，与本节 composer 按钮是两条不同的历史实现，
  未受本次撤回影响）。

## 那条现在缺失的「保存→关→开→看到修改」真栈 e2e（核心验收线）

```bash
pnpm --filter web exec playwright test tests/e2e/chat-diagram-save-reopen-roundtrip.spec.ts --config playwright.fullstack-smoke.config.ts
```

断言（真栈 fullstack：真浏览器 → apps/web → apps/api → PostgreSQL + 对象存储）：

1. 线程里出现一条含 ```mermaid 围栏的 assistant 消息（可由 G2 触发产生，也可直接种入
   ——两条路径至少覆盖一条，覆盖 G2 路径者优先）。
2. 点「最大化」→ modal 打开 → 编辑 markdown（加一个可辨认的新节点文本）→ 点保存 →
   `chat-diagram-saved` 徽章出现。
3. 关闭 modal，**整页 reload**（不是仅关组件——要证明穿透了前端内存态）。
4. 重新进入该线程、再点同一消息的「最大化」⇒ modal 内容含第 2 步加入的新节点文本，
   且 `chat-diagram-loaded-saved` 提示条可见。
5. 点「回到原始版本」⇒ 内容变回不含新节点文本的原始版。

## 门控汇总（签核后实现 feature 时逐条跑）

```bash
node .harness/scripts/lint-arch-deps.mjs
node .harness/scripts/lint-contract-source.mjs
pnpm exec tsx .harness/scripts/verify-uc-coverage.ts phase-01
pnpm --filter api run typecheck
pnpm --filter web run typecheck
```

每个 feature 独立 Issue / 分支 / PR；只有本 design delta 经人类确认后才生成进
`feature_list.json` 并进入 sprint（沿用 `canvas-mermaid-templates/verification.md`
的既有收尾方式）。
