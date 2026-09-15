# 投后财务项目评级 Agent（/agent/team2）— MVP backlog（第三版）

> **临时 Agent，用完即删。** 走 ad-hoc 流程，不建 phase sprint、不进 feature_list。
> 本文件是这个 Agent 的**唯一文档**——需求、架构、backlog、验收标准、删除方式都在这里。
> Phase 16 那份完整需求文档（`phases/phase-16-postinvest-rating-agent/`）仍保留作为
> 若要转正走完整流程时的设计材料，本 ad-hoc MVP 不依赖它，也不受它的签核门控。

## 要解决的问题

帮**投后项目负责人**，在**项目财务评价**中，克服**数据质量、来源不一及行业差别**，
从而**高效、高质、公允**评价项目呈现的趋势、风险。评分规则见
《投后财务项目评级 Agent — 大模型测试方案与模拟测试文件》v1.0（人类提供的 PDF）。

## 架构演进（三版，同 team1 的取舍路径）

| | 第一版：确定性评分引擎 + 手写 HTTP 端点 | 第二版：自建「真聊天框」直连端点 | 第三版（本版）：真实 chat + 真实 Agent |
|---|---|---|---|
| 用户输入 | 结构化字段（不支持真实文件） | 手贴 JSON | 真实上传 Excel/PDF/PPT/Word/录音 |
| 解析 | 无——假设字段已抽取好 | 无——假设字段已抽取好 | Agent 用 `wx_document_parse` 真实解析 |
| 算分 | `apps/api` 确定性 TS 模块 | 同左，经 HTTP 端点调用 | Agent 在 `data-analysis` skill 沙箱里跑脚本 |
| 报告 | 无 | 无 | `pdf-create`/`xlsx-create`（已有平台 skill） |
| 是否接模型 | 否 | 否 | 是——但只用于读材料/抽字段/编排，算分仍是脚本 |
| 新增后端端点 | 1 个（`POST /postinvest-ratings/score`） | 0（复用上一版） | 0（复用真实 chat 既有端点） |

第一、二版的产出（`apps/api/src/domain/postinvest-rating/scoring.ts` 及其测试/验收表）
**没有被丢弃**：它是本版任务书（`apps/web/lib/postinvest-rating/rating-prompt.ts`）里
公式数值的参照实现与验收基准，改规则先改那份、逐字同步到任务书。`POST /postinvest-ratings/score`
端点仍然存在（未删除），但本版工作台不再调用它。

```
/agent/team2（落地页 + 材料预处理）
        │  上传材料 → 选中 Agent（真实已发布 agentId）
        ▼
真实 chat 后端（deep-agent 内核 + AGUI 流式协议 + 真实模型）
  · createPersonalThread  新建一条项目对话
  · updateAgentRoster     把 team2 Agent 挂进这条对话
  · uploadAttachment      材料作为附件真实上传（chat-file-upload 白名单已含 pdf/xlsx/pptx/docx）
  · createMessage         发一条任务书（评分规则 + 沙箱算分要求 + 出报告要求）
        ▼
跳转 /chat?thread=<id> —— Agent 在真实对话里完成解析/算分/出报告，全部在真实 chat UI 里发生
```

## 为什么这样改（对比前两版的取舍）

- **文件解析**（Excel/PDF/PPT）绑死在真实 Agent Run 的沙箱会话上
  （`apps/api/src/infrastructure/agent-run/standard-document-service.ts` 需要一个真实
  `bindingId` 绑定的容器会话），不是能单独拿出来调的裸函数——要支持真实文件必须走
  真实 Agent Run，没有更小的路径。
- **报告生成**同理绑在 `pdf-create`/`xlsx-create` 这两个已有平台 skill 上，它们本来
  就是给真实 Agent 用的，不用为此再造轮子。
- **算分**仍然不让模型心算：任务书要求模型用 `data-analysis` skill 的沙箱脚本真实
  执行公式，并用两个已知算例（+50%→90 分；对数定义点→-35 分）自检脚本对不对。

## 还差一步才能真正跑起来：发布 team2 这个 Agent

`apps/web/lib/postinvest-rating/agent-directory.ts` 的 `agentId` 目前是 `null`——后台
还没有一个真正发布的「team2」Agent。这不是代码缺陷，是一个**需要人类在真实部署环境
里做一次**的操作（本会话是纯前端沙箱，没有连着真实 Postgres/apps/api，做不了这一步）：

```
POST /agents                              # agentRuntime.operations.createAgent
POST /agents/:agentId/submit
POST /agents/:agentId/publish-decision    # 或 self-publish
```

系统提示词建议直接用 `apps/web/lib/postinvest-rating/rating-prompt.ts` 的
`buildRatingPrompt` 里那套规则作为基础（发布时可以固化成 Agent 的 `instructions`，
不必每次靠任务书重复整套公式，但任务书这条路径本身也已经可用）。挂载的 skill 至少要
包含 `document-understanding`、`data-analysis`、`pdf-create`、`xlsx-create`
（均为已有平台级 skill，Phase 13 起对全部组织默认可见，不需要单独导入）。

拿到发布后的真实 id，填进 `agent-directory.ts` 的 `agentId` 字段即可，不用改任何其他
文件。**在此之前，落地页会如实显示「尚未发布，无法发起评级」并禁用按钮**——不会假装能用。

## MVP 边界

### 做（本次交付）
1. `/agent/team2` 落地页：能做什么 / 不做什么 / 上传材料 / 一键发起。
2. 把材料 + 一条结构化任务书（评分公式 + 沙箱算分要求 + 出报告要求）发进一条真实
   项目对话，交给挂载了真实模型的已发布 Agent 处理。
3. 跳转进真实 `/chat` 体验，复用它已有的全部能力（消息流、附件、产物、工具调用可见性）。
4. 保留 `apps/api/src/domain/postinvest-rating/scoring.ts` 作为任务书公式的参照实现
   与验收基准（`apps/api/tests/postinvest-rating/`、`apps/api/scripts/postinvest-rating-acceptance.ts`）。

### 明确不做（MVP 之外）
- ❌ 自建分析结果面板——复用 chat 消息流本身。
- ❌ 新增后端端点/工具——文件解析、算分、出报告、历史检索、行业背景、定期提醒全部
  走已有平台原生能力（见下方「BL4 怎么做的」）。
- ❌ 机械阻断的人工确认关口（HITL）——本版靠任务书用自然语言要求模型在数据不足时
  先问人，不做机械阻断；真正机械阻断需要接 `deep-agent-hitl`，是下一档。
- ❌ 评级记录的正式版本链（`draft → confirmed` 状态机、版本号 +1、独立持久化表）
  ——这是 Phase 16 完整需求才有的数据模型。本 MVP 靠**同一条 chat 线程的消息历史**
  当版本轨迹：反馈与修正后的结论都是同一线程里的新消息，可回看，但不是一张可查询、
  可机械断言状态迁移的表。
- ❌ 未登录公开访问。

### BL4 怎么做的（历史对比 / 行业背景 / 反馈闭环 / 定期评级，均靠任务书调用原生工具）
四项此前登记为"依赖存储和检索基础设施"的能力，实测都有现成的原生工具可以直接用，
不需要新基础设施——补进了 `rating-prompt.ts` 的第四~七部分：
- **历史同期对比**：`wx_knowledge_search`/`wx_knowledge_read`（原生工具）搜本项目
  此前的评级报告，做同比/环比与趋势判断；没搜到就如实写"首次评级"。
- **受限渠道行业背景**：`web_search`（原生工具）+ 任务书里写死的 9 个可信域名
  （巨潮/上交所/深交所/北交所/港交所披露易/证监会/企业信用公示/统计局/被评公司官网），
  命中以外一律丢弃，不改分数。
- **反馈闭环**：靠同一条线程里的自然语言往返——用户回复指出问题，任务书要求模型先
  分类（5 类，同 Phase 16 R3-13 的分类口径），"主观偏差"只记录不改结论，其余四类
  重算受影响部分并在新消息里说明改了什么。**这是提示词约定，不是机械阻断**（同 team1
  的两轮确认限制，模型可能不严格遵守）。
- **定期评级**：`wx_schedule_create`（原生工具）——仅当用户在对话里明确要求时才建，
  任务书禁止到期后自动复用旧数据出分，必须提示用户先补新报表。

### 已知限制（不要假装它们已解决）
1. **算分正确性依赖模型把脚本写对。** 任务书给了公式和两个自检算例，但模型仍可能
   写错脚本；`data-analysis` skill 的方法论要求记录代码与重跑核对，能发现明显错误，
   但不是形式化证明。
2. **BL4 全部四项都是提示词约定，不是机械阻断。** 模型可能不严格执行（如反馈闭环的
   五类分诊、行业背景的域名白名单过滤）；真正机械阻断需要契约层校验或工具参数强约束，
   是下一档，不在本次。
3. **本会话环境无法端到端验证真实模型输出质量。** 需要在接了真实 Postgres + 真实模型
   的部署环境里跑，不是这个纯前端沙箱能证明的。
4. **`agentId` 未发布前整个流程不可用**，见上一节。

## Backlog

| # | 条目 | 状态 |
|---|---|---|
| B1 | 确定性评分引擎（参照实现 + 验收基准） | ✅ `apps/api/src/domain/postinvest-rating/scoring.ts` |
| B2 | `POST /postinvest-ratings/score`（仍存在，本版工作台不再调用） | ✅ 已合并 |
| B3 | 评级任务书（公式 + 沙箱算分要求 + 出报告要求） | ✅ `lib/postinvest-rating/rating-prompt.ts` |
| B4 | 发起真实对话：建线程 + 挂 Agent + 传附件 + 发任务书 | ✅ `lib/postinvest-rating/launch-rating-thread.ts` |
| B5 | `/agent/team2` 落地页与材料预处理 UI | ✅ `app/agent/[teamId]` + `components/postinvest-rating/rating-agent-launcher.tsx` |
| B6 | 发布 team2 为真实 Agent，回填 `agentId`，挂载所需 skill | ⬜ 需要人类在真实部署环境操作，见上 |
| B7 | 机械阻断的人工确认（接 `deep-agent-hitl`） | ⬜ 下一档，不在本次 |
| B8 | 历史同期对比（`wx_knowledge_search`/`wx_knowledge_read`） | ✅ `rating-prompt.ts` 第四步（提示词约定，见「已知限制」） |
| B9 | 受限渠道行业背景（`web_search` + 9 域名白名单） | ✅ `rating-prompt.ts` 第五步（提示词约定） |
| B10 | 反馈闭环（五类分诊，主观偏差只记录） | ✅ `rating-prompt.ts`「反馈修正」节（提示词约定，非机械阻断） |
| B11 | 定期评级提醒（`wx_schedule_create`） | ✅ `rating-prompt.ts`「定期评级」节 |

## 验收

`apps/api/tests/postinvest-rating/scoring.test.ts` + `apps/api/scripts/postinvest-rating-acceptance.ts`
覆盖公式本身（自动化、不需要真实模型）。**Agent 端到端行为**的验收需要 B6 完成、`agentId`
回填后，在真实部署环境里上传一份真实财务报表并发起评级，人工核对：
- 是否真实调用了 `data-analysis` 沙箱脚本（不是模型直接报数字）；
- 算出的分数是否与两个自检算例（+50%→90 分；对数定义点→-35 分）一致；
- 最终 PDF/Excel 报告是否真实生成、可下载。

本仓无法在纯前端沙箱里自动跑出这份验收。

## 怎么删干净（这个 Agent 是临时的）

```bash
rm -rf apps/web/lib/postinvest-rating apps/web/components/postinvest-rating \
       apps/api/src/domain/postinvest-rating apps/api/src/application/postinvest-rating \
       apps/api/src/interface/controllers/postinvest-rating.controller.ts \
       apps/api/tests/postinvest-rating apps/api/scripts/postinvest-rating-acceptance.ts \
       docs/agents/team2-postinvest-rating-mvp.md
```
再把 `apps/web/app/agent/[teamId]/page.tsx` 里 team2 分支、`apps/web/next.config.mjs` 里
`/postinvest-ratings/:path*` 的 rewrite、`apps/api/src/kernel.module.ts` 里
`PostinvestRatingController` 的注册删掉即可。若已按 B6 发布了真实 Agent，记得同时在
后台把该 Agent 下线/删除。没有数据库迁移、没有新增持久化表——删完不留残骸。
