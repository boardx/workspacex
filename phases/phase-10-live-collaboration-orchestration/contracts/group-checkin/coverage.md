# `group-checkin` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F05 | `requirements/02-group-checkin.md#R1` | 分组签到聚合视图（4 组卡片网格）——UI 骨架已建，服务端聚合查询待落地 |
| F06 | `requirements/02-group-checkin.md#R2` | 到场判定/二维码/加入页三个待确认点——Q2/Q4/Q5 已裁决，待实现 |

## 反向检查

- `requirements/02-group-checkin.md` 全文两节（R1/R2）均已被 F05/F06 覆盖，无遗漏章节。
- R2 列出的 3 个待确认点（到场判定口径、二维码生成方式、看加入页目标）均已在
  `OPEN-QUESTIONS.md` Q2/Q4/Q5 裁决，本束 notes 与本文件均已同步这三条结论，
  未出现"同一事实声明在两处却结论不同"的漂移。
- `ui.md` 列出的组长/观察者可见性缺口（G-系列以外，视角/态矩阵里的"待定"格）尚未对应到
  任何 feature 的 verification——是否需要新增一个 feature 覆盖这两个角色的可见性，
  还是靠 `viewer-role` 束的角色矩阵间接约束，签核时请一并定。
