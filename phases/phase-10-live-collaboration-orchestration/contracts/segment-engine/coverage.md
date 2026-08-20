# `segment-engine` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F03 | `requirements/00-overview.md#R1` | 状态条复用 F963 数据源，编排层渲染一致性——UI 骨架已建 |
| F04 | `requirements/00-overview.md#R1`（倒计时段落） | 倒计时字段——跨 phase-01 议程束的契约变更请求，待对方确认后落地 |

## 反向检查

- `requirements/00-overview.md#R1` 全段（含状态条描述、倒计时段落、"需介入"判据段落）均已被
  F03/F04 覆盖或显式标记为不在本轮签核范围（"需介入"判据）——无遗漏内容，也没有把不该本束
  拍板的跨 phase 事项悄悄内化成本束的既成决定。
- `00-overview.md` 硬前置段落提到的"素材充足度""现场介入标记"两个字段**不属于本束**
  （它们出现在 stage-aggregation/module-routing 的看板与本场状态相关场景），
  本束的 `＊` 占位仅限倒计时与"需介入"两处，未越界覆盖其它束的无来源字段。
