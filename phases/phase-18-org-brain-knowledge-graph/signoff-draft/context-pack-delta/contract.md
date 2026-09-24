# design delta · context-pack：通道可用性 + 图路径（D-KG-1 = A，D-KG-2 = A）

> 目标位置：签核 PR 里移到 `phases/phase-00-shared-kernel/design-deltas/context-pack-channel-availability-graph-path/`。
> base_bundle：phase-00 `context-pack`（已签）。人类裁决：2026-09-24「按你的建议来决定」（D-KG-1 A、D-KG-2 A）。

## 改什么（只加可选 / 带默认值的字段，不删不改已有字段）

1. `RetrievalChannelPlan` 加 `available: boolean`（默认 `true`）。
   - 某一路（graph / vector）这次没能执行时为 `false`，同时 `hitCount = 0`。
   - 不新增 `omission-reason` 类别：「通道不可用」是整路的状态，不是某条内容被丢弃。omissions 的封闭枚举不动。
2. `ContextItem` 加可选 `graphPath: Array<{ src: { kind, id, label }, relation, dst: { kind, id, label } }>`。
   - 只在该条经图路召回时出现，内容是召回**实际走过**的边。
   - `relation` 取 `chat-knowledge-graph` 束的 `KgRelation`，不在 context-pack 里另定一份。

## 不变量

- **D-I1**：`available = false` 的通道，`hitCount` 必为 0，且 `items[].channels` 不含该通道。
- **D-I2**：`graphPath` 非空 ⇒ `channels` 含 `graph`。
- **D-I3**：已签的 I-5（同 runId 可重放）继续成立：`available` 与 `graphPath` 随 Context Pack 一起落库、一起重放。

## 为什么不影响已签的行为

两个字段都可选或有默认值，已有调用方不传也不读，行为不变。已有的 `context-pack-*.test.ts` 不需要改。
