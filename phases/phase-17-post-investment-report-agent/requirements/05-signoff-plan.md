# 05 · 人类签核计划（这份需求里，需要你签的是哪几件）

> **纪律**：签核是**人的动作，agent 不许改 status**（AGENTS.md「设计签核（三件、一处签）」/ ADR-023）。
> 本文件只把"要签什么、签在哪、签之前谁该先干完什么"列清楚，**它本身不是签核面**。

## 现在就等你的（第 0 轮：需求本身）
在把需求转成 `feature_list.json` 之前，先确认这份 `requirements/` 没跑偏。逐项打勾即可：

| 编号 | 待确认事项 | 在哪看 | 状态 |
|---|---|---|---|
| S0-1 | 北极星与硬边界：**不给投资/退出结论**，只给事实、缺口、风险窗口与前置条件 | `00-overview.md` | ☐ 待人类确认 |
| S0-2 | 成功标准 S1-S8 的数值门槛（尤其 S1 数据准确率 100%、S6 免修订率 ≥70%、S7 提效 ≥50%） | `00-overview.md` | ☐ 待人类确认 |
| S0-3 | 两处人工确认关口的位置与**阻断性**（未确认不深挖）是否符合你的实际工作方式 | `01-interaction-journey.md` 第 8/9 步 | ☐ 待人类确认 |
| S0-4 | 材料类目 `PI-M-*`、财务指标集 `PI-F-*` 是否够用、有无多余 | `03` A/B 节 | ☐ 待人类确认 |
| S0-5 | 风险判据 `C-*` 的**阈值**（集中度 30%/60%、价差 10%、补助占比 30%、周转天数 +20%…）是否要按本基金口径调整 | `03` C 节 | ☐ 待人类确认 |
| S0-6 | 报告章节 `F-1…F-11` 与归档模板是否对齐现有投后报告格式 | `03` F 节 | ☐ 待人类确认 |
| S0-7 | 外部渠道范围（企查查/天眼查/裁判文书网/研报）本阶段只用**公开页面**、不接付费源 | `02` 数据与合规要求 | ☐ 待人类确认 |
| S0-8 | A/B/C 三组的通过标准与 E-1…E-13 端到端断言 | `04-acceptance-tests.md` | ☐ 待人类确认 |

确认方式：直接在本文件把 ☐ 改成 ☑ 并署名日期，或在对应 GitHub issue 上留言逐条回复。
**有异议的条目请写一句为什么**——它会变成 `feature_list.json` 的 verification，而不是留在聊天里。

## 之后才轮到的（第 1 轮：正式的三件一处签）
S0 过了才开始，顺序不能颠倒：

1. **requirement-author** 读本文件夹 → 生成 `../feature_list.json`（权威功能清单）。
2. **ui-prototyper** 用 `apps/web` 真实组件 + mock 把界面做出来 → 截图存 `../ui-preview/`
   （束↔截图目录映射要同步进 `.harness/scripts/ui-material-map.json`，否则 `lint-ui-material.mjs` 会红）。
3. 按能力域切**契约束**（建议四束：`material-set`（材料包与解析）、`pi-analysis`（指标与风险）、
   `pi-report`（产出物与出处链）、`pi-hitl`（确认关口与裁决）），每束在
   `../contracts/<bundle>/` 下产出 `uc.md` / `ui.md` / `domain.md` / `coverage.md` 与**一份**
   `design-signoff.md`，你在那一份里一次签三节：**① UI ② 用例 ③ API 契约**。
   ③ 的正文住在 `packages/contracts/src/<bundle>.ts`（zod 单一事实源），签核面只引用它。
4. 阶段**一致性复核**：查四束交叉约束是否打架（例如 `pi-hitl` 的裁决 payload 与 `pi-report`
   的报告章节对同一条风险的字段定义必须是同一份）。
5. 一致性复核通过后，feature 才可开工（`harness claim`）。

## 为什么不现在就把 `contracts/` 目录建好
`contracts/<束>/` 一旦建出来，`design-signoff.ts` / `lint-ui-material.mjs` /
`lint-contract-source.mjs` 等机械门控立刻对它生效——而此刻 `feature_list.json` 还没有、
截图还没有、`covers:` 该写哪几个 feature 编号也还不知道。**先建目录只会制造一批注定红的门控**，
不会让签核更早发生。所以本阶段的顺序是：S0 确认 → 功能清单 → 原型截图 → 建束 → 你签三件。
