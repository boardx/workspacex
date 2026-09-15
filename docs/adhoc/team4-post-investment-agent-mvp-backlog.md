# Ad-hoc backlog — `/agent/team4` 投后管理报告 Agent · MVP

> 走 ad-hoc 流程（`.harness/instructions/ad-hoc-fix-pr-sop.md`），不建 phase / 不进
> `feature_list.json`。原因：人类明确说这是**临时 agent，后面要删**——不值得建一套
> sprint/feature 生命周期。本文件是这次 ad-hoc 改动的唯一计划记录，随 PR 走完即可归档，
> 不需要长期维护成"权威清单"。
>
> 完整需求文档（目标用户/成功标准/风险判据/报告模板等）仍在
> `phases/phase-17-post-investment-report-agent/requirements/`，作为**参考材料**保留——
> 它描述的是"这个 Agent 理想状态下该做什么"，MVP 只挑其中一小片先做出来、先能验收。

## MVP 边界（对照测试方案定的最小可验收范围）

**只做测试 A（单份材料·显性风险识别），不做测试 B/C。**

理由：B/C 需要多文件材料包、外部检索（企查查/天眼查/研报）、可比公司对标、跨文件
交叉验证引擎、HITL 两道确认关口的完整闭环——这些都是真实的工程量，不是"多写一段
prompt"就能验收的东西。B/C 与两道人工确认关口列入"下一步"，明确不在这次 PR 里。

**做什么（Test A 可验收的最小闭环）**：
1. `/agent/team4` 一个真实页面（不是 mock 卡片）：粘贴/输入单份材料文本 → 点击分析
   → 拿到结构化结果。
2. 结构化结果 = 财务指标抽取（营收/净利润/毛利率/经营性现金流，含同比）
   + 风险清单（显性异常，四列：编号/问题/原因/材料中如何体现）。
3. 派生数值（同比）由后端算，不让模型心算——避免模型算错还叫"通过验收"。
4. 模型输出解析失败 / 模型不可用 → 明确的失败态（不是空白转圈，不是编造）。
5. 真实模型链路跑测试文件 A，人工核对命中 `A-R01/A-R02/A-R03` ≥2 项。

**明确不做（写清楚是为了不让人以为漏了）**：
- 不做批量/文件夹上传、不做 PDF/Office 结构化解析与页码级出处回跳——MVP 输入是
  粘贴文本，出处是"文本高亮/原文片段"，不是 bbox 级定位。
- 不做外部检索（企查查/天眼查/研报）、不做可比公司对标——测试 B/C 需要，MVP 不需要。
- 不做两道人工确认关口（确认/驳回/补充、风险分级）、不做定向深挖、不做报告归档/
  下载/模板套用、不做出处链四要素（agentVersion/skillVersion/modelId/权限快照）。
- 不做未登录落地页与登录态区分的产品化设计——未登录时调用分析接口会拿到 401，
  页面显示"请先登录"，不做单独的营销落地页文案。
- 不新建 Skill 持久化/挂载（`mountSkill` 契约在本仓当前是**零实现**契约，见
  `packages/contracts/src/agent-runtime.ts` 头注）——prompt 直接写在后端用例里，
  不装配成可发布 Skill。这个 Agent 本来就要删，不值得为它建 Skill 版本管理。

## 实现计划（复用已有基础设施，不新建栈）

| 层 | 复用 | 新增 |
|---|---|---|
| 模型调用 | `MODEL_CALL_PORT` / `ModelCallPort.complete`（`agent-run/ports.ts`）；复用既有 `FEEDBACK_STRUCTURE_MODEL_CONFIG` 绑定，不新配一套模型选型 | 用例 `analyzePostInvestmentMaterial`（同 `structureFeedbackDraft` 的"固定 prompt + JSON 容错解析"骨架） |
| 派生计算 | — | 同比/毛利率等纯函数，服务端算，模型只负责定性解释 |
| 契约 | `@repo/contracts` 的 `operations` 注册惯例 | 新束文件 `post-investment-report.ts`：`analyzePostInvestmentMaterial` 一条操作 |
| 路由 | `CurrentPrincipal` + `assertPrincipal` 鉴权惯例（同 `FeedbackController`） | `PostInvestmentController`：`POST /post-investment/analyze` |
| 前端 | `apiRequest`（`lib/api-client.ts`）、`AppShell` | `/agent/team4/page.tsx`（静态路由优先于 `/agent/[teamId]` 的 mock 分支） |

## 验收（对应测试方案 A 组）
- 真实模型链路：把测试文件 A 全文粘进 `/agent/team4`，人工核对输出命中
  `A-R01`（增收不增利）/`A-R02`（现金流转负）/`A-R03`（资本化率异常）≥2 项，
  且数据与原文一致（营收 4,680 万/净利润 385 万/毛利率 29.5%/现金流 −860 万等）。
- 派生指标可重复：同一段文本跑三次，同比等数值完全一致（服务端算，非模型算）。
- 模型不可用时接口返回明确错误码，前端显示可读文案，不空白转圈、不编数字。

## 下一步（本次不做，若要做 B/C 再开新的 ad-hoc 或转 phase）
外部检索与对标、跨文件交叉验证、文件上传+结构化解析（页码/bbox 出处）、两道人工
确认关口、定向深挖、报告归档与出处链四要素——这些量级已经不是"ad-hoc"，真要做
建议回到 `phases/phase-17-post-investment-report-agent/` 走正规 feature 流程。
