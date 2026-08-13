# PROP-OVERVIEW-UPSTREAM-SURVEY-001 —— 「数据总览」屏逐格上游勘探（Q-12 的裁决材料）

> **这不是提案，是材料。** 它不主张任何一种归属，只回答一个 Q-12 现在还没有答案的问题：
> **总览屏那些格子，今天各自有没有真实上游？没有的缺什么？**
>
> 实测 SHA：**`0b38ee81`**（`origin/main`，2026-08-14）。
> 下面每一行都是在这个 SHA 上跑 grep / 读迁移 / 读控制器读出来的，不是读注释推的。
> 静态痕迹会骗人（AGENTS.md），所以判据一律用「路由存不存在 / 表存不存在 / 谁 import 它」，
> 不用「注释说它做了」。

## 为什么现在做这份材料

Q-12（`23-asset/OPEN-QUESTIONS.md`）已经把归属的三个候选 A/B/C 和推荐写清楚了，缺的不是选项。
缺的是**代价**：A（屏内容留给 phase-03）与 C（把 UC 移进 phase-01）的差别，取决于
「屏内容离能跑还差多少」。如果多数格子已经有真端点，那它就是几天的接线；
如果多数格子的上游根本不存在，那它是 phase-03 的一整块新功能。这份材料把那个数字摆出来。

## 结论先说

**七个格子里，四个今天就能接真端点，三个的上游不存在。**
能接的四个的上游**全部已合入 main 且 passing**；不能接的三个缺的是同一样东西——
**一张 `anomalies` 表和它的读写面**，也就是 phase-03 的 **F15**。

## 逐格

| # | 屏上的格子 | 现在读什么 | 真上游 | 今天能不能接 |
|---|---|---|---|---|
| ① | 本月 token 消耗 | `OVERVIEW_METRICS[0]`（写死 `4,820 万`） | `GET /organizations/:orgId/usage` → `totalTokens`（F159 计量 + F161 报表） | ✅ **能** |
| ② | 活跃成员 | `OVERVIEW_METRICS[1]`（写死 `47 人`） | 同上 → `activeMemberCount`（契约逐字：「窗口内有过调用的人数——不是组织成员总数」） | ✅ **能** |
| ③ | 异常待处理（计数） | `OVERVIEW_METRICS[2]`（写死 `3 项`） | **没有单一上游**，见下方「③ 的裂缝」 | ⚠ **半个** |
| ④ | 异常清单 + 严重度 | `OVERVIEW_ANOMALIES`（三条写死） | 同 ③ | ⚠ **半个** |
| ⑤ | 活动流 | `OVERVIEW_ACTIVITY`（七条写死） | `GET /provenance`（F03/F08，`provenance_events` 表） | ✅ **能** |
| ⑥ | 查看调用链（抽屉） | `ANOMALY_CHAINS`（三条写死） | ✗ 无「按异常展开调用链」的端点 | ❌ **不能** |
| ⑦ | 标记为正常 | 纯前端 `useState` | 契约里有 `markAnomalyNormal`，**无任何实现** | ❌ **不能** |
| ⑧ | 导出 CSV / 生成月度报告 | 只弹 Toast | ✗ 全仓无组织级审计导出端点（只有 `/projects/:projectId/audit/export`，项目级） | ❌ **不能** |

### ①② 的上游确实在 main 上（不是「分支上有」）

```
origin/main:phases/phase-01-run-a-project/feature_list.json  F159..F163 → 全部 passing
origin/main:apps/api/migrations/20260812030000_f159_token_usage_events.sql   存在
origin/main:apps/api/migrations/20260812040000_f160_member_token_quota.sql   存在
origin/main:apps/api/migrations/20260812050000_f162_limit_rules.sql          存在
apps/api/src/interface/controllers/org-admin-management.controller.ts:546   @Get("/organizations/:orgId/usage")
```

### ⑤ 的上游：`provenance_events` 的 type 是个闭集，活动流的每一行都能从它派生

`0005-f03-admin-boundary.sql` 的 CHECK 约束逐字列出 17 个 type，其中与活动流直接对应的有：
`capability-added` / `capability-updated` / `capability-disabled` / `role-changed` /
`team-changed` / `admin-project-access` / `local-export` / **`unauthorized-attempt`**。

对照屏上那七行写死的活动：模型标记、读取项目内容（已留痕）、拦截 agent 调用、
接入模型、收紧 agent 可见性、放行 MCP 评审、导出审计——**七行全部落在这个枚举里**。
读端 `GET /provenance`（`provenance.controller.ts:44`）已实现。

### ③ 的裂缝：「异常」在今天不是一个东西，是两个

屏上「异常待处理 3 项 · 2 额度异常 · 1 越权调用」把两类东西加在了一起，而它们的上游完全不同：

| 异常类型 | 上游 | 状态 |
|---|---|---|
| **额度异常** | `GET /organizations/:orgId/limit-events`（F162，`limit_events` 表） | ✅ 已在 main |
| **越权调用** | `GET /provenance?types=unauthorized-attempt`（F03/F08） | ✅ 已在 main |

所以「计数」和「清单」勉强能拼出来——**但那是前端把两个数组拼起来**，
而屏上还要求排序（按严重度）、去重、"未处理" 状态、以及 ⑦「标记为正常」。
**这四样都需要一个「异常」实体，而它不存在**：

```
apps/api/migrations/*.sql        grep -i anomal  →  0 命中（没有 anomalies 表）
apps/api/src/interface/**        grep "/anomalies" →  0 命中（没有路由）
packages/contracts/agent-runtime.ts:2467  listAnomalies      契约有
packages/contracts/agent-runtime.ts:2482  markAnomalyNormal  契约有
packages/contracts/agent-runtime.ts:2427  queryOrgAudit      契约有
apps/api/src/domain/agent/anomaly-detection.ts    判定函数有（10 倍 / 24h 滚动窗口，O-36）
  谁 import 它 → 只有 apps/api/tests/capability/agent/anomaly-10x-24h-rate-limit.test.ts
                （它自己的测试，纯内存，不 import PgDatabase）
```

⚠ **这与 F68 是同一种形态**：判定逻辑写好了、契约定好了、测试是绿的，
但它**没有被任何产品代码调用**，也没有地方存判定结果。
「F60 passing」是真的——它验的那层真的成立，只是那层之下是空的。

### 谁该补：phase-03 F15，名字就写着

```
phases/phase-03-reuse-and-governance/feature_list.json
  F15  not_started
  「权限异常越权拦截计数 + 限速 + 拦截告警合规负责人（最小影响）+ 消耗离群只告警 +
    埋点不可用保守策略」
```

③④⑥⑦ 缺的东西——异常实体、自动限速、标记为正常与解除限速、埋点不可用时的保守策略——
逐条落在 F15 的标题里。**⑧（组织级导出与月度报告）不在 F15 里**，全仓也没有别的 feature 认领它。

## 这对 Q-12 的三个候选意味着什么

材料只陈述代价，不推荐选项。

- **若选 A（屏内容留给 phase-03）**：①②⑤ 三个格子今天就能接的事实**不会消失**，
  它只是要等 phase-03。代价是：三个已经有真数据的格子在界面上继续显示写死的
  `4,820 万 / 47 人 / 七条活动`，而真数就在同一个进程里。
  ⚠ Q-12 自己已经写到这个风险（「已建成代码处于悬空态，必须被登记为可见缺口」）——
  这份材料把「悬空的具体是什么」补全了：**悬空的是 3 个可接的格子 + 4 个不可接的格子，不是一整屏**。
- **若选 C（把 uc-17-1 / 17-7 移进 phase-01）**：phase-01 会同时收下
  「今天能接的 3 个」和「要等 F15 的 4 个」。后者会在 phase-01 变成一个
  `not_started` 且**依赖 phase-03 F15** 的 feature，也就是把跨阶段依赖从 UC 层挪到 feature 层。
- **B（抄一份 UC）** 仍然不推荐，理由与 Q-12 原文一致（第九次「同一事实声明在两处」）。

## 一个不需要等 Q-12 的观察

无论怎么裁，**⑧「生成月度报告 / 导出活动流 CSV」今天是两个只弹 Toast 的按钮**，
且全仓没有任何 feature 认领它。它既不在 phase-01 的 feature_list 里，也不在 F15 的标题里。
这一条与归属无关——它是**漏登记**，建议单独开条目，不要跟着 Q-12 一起等。

## 复现方式

```bash
git fetch origin && git checkout 0b38ee81
grep -ril anomal apps/api/migrations/            # 期望：0 命中
grep -rn '"/anomalies' apps/api/src/interface/   # 期望：0 命中
grep -rn 'anomaly-detection' apps/api/src        # 期望：0 命中（只有 tests/ 里有）
grep -n 'CHECK (type IN' -A 6 apps/api/migrations/0005-f03-admin-boundary.sql
grep -n '@Get("/organizations/:orgId/usage")' apps/api/src/interface/controllers/org-admin-management.controller.ts
```
