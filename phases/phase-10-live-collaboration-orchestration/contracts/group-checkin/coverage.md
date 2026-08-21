# `group-checkin` — feature ↔ 需求映射

| feature | 需求出处 | 覆盖情况 |
|---|---|---|
| F05 | `requirements/02-group-checkin.md#R1` | 分组签到聚合视图（4 组卡片网格）——UI 骨架已建，服务端聚合查询待落地 |
| F06 | `requirements/02-group-checkin.md#R2` | 到场判定/二维码/加入页三个待确认点——Q2/Q4/Q5 已裁决，待实现 |

## R12 门控映射（第 ③ 件形态 A：复用 `packages/contracts/src/org-admin.ts` 的 `getCheckinBoard`，见 `third-artifact-map.json`）

> ⚠ 写这份映射时 F05 正在另一个并行分支开发（本文件所在分支未见其 controller/前端改动，
> 不能凭空断言那些文件已存在——见 `AGENTS.md`「静态痕迹 ≠ 动态事实」）。这里只登记
> **当前分支已确认真实存在**的部分；F05 合并时应把自己那部分的门控命令补齐/覆盖本表，
> 不要保留这条本文件写下时的过渡状态。

| R12 | 一句话 | 门控命令（API 操作） | 后端落点 | 状态 |
|---|---|---|---|---|
| V1 | 到场回写（撤销后 5 秒失效、已在场者保留至环节结束）——F16 既有、已 passing 的用例，`group-checkin` 束的聚合视图将复用同一份数据，不重建 | `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/auth/checkin-writeback.test.ts` | `apps/api/src/application/auth/get-checkin-board.ts`（F16 既有用例） | ✅ |

**缺口 1**（文字登记，不放进上表）：F05（分组签到聚合视图的 HTTP 路由 + 前端渲染）
截至本文件落笔时仍在并行分支开发中，尚未合入——上面 V1 只覆盖已确认存在的到场回写能力，
不包含 F05 自己那部分的门控命令，F05 合并时需要补上。

## 反向检查

- `requirements/02-group-checkin.md` 全文两节（R1/R2）均已被 F05/F06 覆盖，无遗漏章节。
- R2 列出的 3 个待确认点（到场判定口径、二维码生成方式、看加入页目标）均已在
  `OPEN-QUESTIONS.md` Q2/Q4/Q5 裁决，本束 notes 与本文件均已同步这三条结论，
  未出现"同一事实声明在两处却结论不同"的漂移。
- `ui.md` 列出的组长/观察者可见性缺口（G-系列以外，视角/态矩阵里的"待定"格）尚未对应到
  任何 feature 的 verification——是否需要新增一个 feature 覆盖这两个角色的可见性，
  还是靠 `viewer-role` 束的角色矩阵间接约束，签核时请一并定。
