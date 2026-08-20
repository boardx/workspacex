# `stage-aggregation` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F09 | `requirements/03-module-routing.md#R2`（第 1 点：看板） | UI 骨架已建；真实数据对接完全阻塞于 phase-02 F02，见 design-signoff.md 硬阻断 |
| F10 | `requirements/03-module-routing.md#R2`（第 2 点：知识图谱·决策推演） | UI 骨架已建；真实数据对接完全阻塞于 phase-02 F11/F15/F16/F17，见 design-signoff.md 硬阻断 |

## 反向检查

- `requirements/03-module-routing.md#R2` 三点中，第 1、2 点（看板、知识图谱）已被 F09/F10 覆盖；
  第 3 点（分组与签到）**不属于本束**，归 `group-checkin` 束（F05/F06）——本文件不越界声明。
- `00-overview.md` 硬前置段落"phase-02 的知识图谱/看板领域模型（F11/F02/F15-F19）目前
  `not_started` 且无契约束签核"这一条，是本束两个 feature 共同的阻塞源，已在 F09/F10 各自的
  notes 与本 design-signoff.md 里**只声明一次**（本文件是唯一权威落点），未在其它束重复声明
  同一条阻塞（`module-routing` 束的"本组图谱"消费同一个 phase-02 知识图谱数据，但那是分组粒度、
  不同的交叉点，两束的 design-signoff.md 交叉约束表分别列出，不是重复声明同一件事）。
