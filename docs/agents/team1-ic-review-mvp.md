# 上会材料审阅 Agent（/agent/team1）— MVP backlog

> **临时 Agent，用完即删。** 走 ad-hoc 流程，不建 phase、不建 sprint、不进 feature_list。
> 本文件是这个 Agent 的**唯一文档**——需求、架构、backlog、验收标准、删除方式都在这里。

## 要解决的问题（HMW）

帮**投资分析人员**，在**集团投决会前项目分析**中，克服**资料分析工作量大、时间长**，
从而**快速识别资料问题，加速沟通与分析过程**。不是替人做投资判断——只把
「读材料 / 对标准查缺 / 找矛盾」的机械活拿走。

## 架构（2026-09-15 第二版 —— 复用真实 chat，不自建分析引擎）

**第一版**（已废弃）是纯浏览器正则规则引擎 + 自建三栏工作区，零幻觉但也零智能，
且和真实 chat 是两套平行系统。用户明确要求改为**复用 chat 的真实能力**：

```
/agent/team1（落地页 + 材料预处理）
        │  上传材料 → 选中 Agent（真实已发布 agentId）
        ▼
真实 chat 后端（deep-agent 内核 + AGUI 流式协议 + 真实模型）
  · createPersonalThread  新建一条项目对话
  · updateAgentRoster     把 team1 Agent 挂进这条对话
  · uploadAttachment      材料作为附件真实上传
  · createMessage         发一条任务书（审阅指令 + 上会标准 + 交叉验证要求）
        ▼
跳转 /chat?thread=<id> —— 后续提纲/缺失清单/风险标注/两轮人工确认
全部在真实 chat UI 里发生，本仓不重画
```

`/agent/team1` 因此只有两件事：① 展示这个 Agent 是什么、能干什么、边界在哪；
② 把材料和一条写清楚了的任务书发进一条真实对话。**没有新增任何后端端点**，
全部调用既有 `lib/live-chat.ts` 的真实 API（Wave 2 durable message + queued AgentRun，
`apps/api` 有真实 Postgres 支撑，不是 mock）。

### 为什么这样改（对比第一版的取舍）

| | 第一版：本地规则引擎 | 第二版：真实 chat |
|---|---|---|
| 智能程度 | 靠正则关键词，读不懂语义、认不出没预设的问题模式 | 真实模型阅读理解，能处理规则覆盖不到的情况 |
| 与产品的关系 | 平行于 chat 的第二套系统，用完即弃 | 就是 chat 本身多一个可选 Agent，删除成本低（见下） |
| 人工确认关口 | 前端状态机模拟，未真正阻断 | 写进任务书让模型主动停下等确认；机械阻断需要 deep-agent-hitl，本版未接线（见「已知限制」） |
| 可验收性 | 100% 可本地跑分（无模型依赖） | 依赖真实部署 + 真实模型，本会话环境内无法端到端跑出结果（见下） |

## 还差一步才能真正跑起来：发布 team1 这个 Agent

`lib/ic-review/agent-directory.ts` 的 `agentId` 目前是 `null`——后台还没有一个真正
发布的「team1」Agent。这不是代码缺陷，是一个**需要人类在真实部署环境里做一次**的
操作（本会话是纯前端沙箱，没有连着真实 Postgres/apps/api，做不了这一步）：

```
POST /agents                              # agentRuntime.operations.createAgent
POST /agents/:agentId/submit
POST /agents/:agentId/publish-decision    # 或 self-publish，见 agent*.controller.ts
```

拿到发布后的真实 id，填进 `agent-directory.ts` 的 `agentId` 字段即可，不用改任何
其他文件。**在此之前，落地页会如实显示「尚未发布，无法发起审阅」并禁用按钮**——
不会假装能用。

## MVP 边界

### 做（本次交付）
1. `/agent/team1` 落地页：能做什么 / 不做什么 / 上传材料 / 一键发起。
2. 材料预处理：读取纯文本族、逐文件哈希记账；读不了的单列清单，不静默跳过。
3. 把材料 + 一条结构化任务书（上会标准 IC-1…IC-8 + 交叉验证三分类要求 + 输出格式 +
   两轮人工确认约定）发进一条真实项目对话，交给挂载了真实模型的已发布 Agent 处理。
4. 跳转进真实 `/chat` 体验，复用它已有的全部能力（消息流、附件、审批卡、产物）。

### 明确不做（MVP 之外）
- ❌ 自建分析结果面板（提纲/清单/风险三栏）—— 复用 chat 消息流本身。
- ❌ PDF / Word / Excel / PPT 解析 —— 这类文件交给 chat 附件面板与后端既有能力，
  本页只做「能不能先本地转成文本」的粗筛。
- ❌ 机械阻断的人工确认关口 —— 本版只在任务书里用自然语言要求模型停下等确认；
  真正机械阻断需要接 `deep-agent-hitl`，是下一档。
- ❌ 未登录公开访问、归档模板、通知与定时。

### 已知限制（不要假装它们已解决）
1. **两轮人工确认是提示词约定，不是机械阻断。** 模型可能不严格遵守；如果发现模型
   一次性把深挖也做了，属于已知限制，不是本页的 bug。
2. **本会话环境无法端到端验证真实模型输出质量。** 下面的验收标准仍然有效，但需要
   在接了真实 Postgres + 真实模型的部署环境里跑，不是这个纯前端沙箱能证明的。
3. **`agentId` 未发布前整个流程不可用**，见上一节。

## Backlog

| # | 条目 | 状态 |
|---|---|---|
| B1 | 上会标准清单 IC-1…IC-8（41 条，任务书用） | ✅ `apps/web/lib/ic-review/standard.ts` |
| B2 | 材料接收：读取 + sha256 + 可解析性判定 | ✅ `lib/ic-review/intake.ts` |
| B3 | 审阅任务书生成（标准 + 交叉验证要求 + 输出格式 + 两轮确认约定） | ✅ `lib/ic-review/review-prompt.ts` |
| B4 | 发起真实对话：建线程 + 挂 Agent + 传附件 + 发任务书 | ✅ `lib/ic-review/launch-review-thread.ts` |
| B5 | `/agent/team1` 落地页与材料预处理 UI | ✅ `app/agent/[slug]` + `components/agent/ic-review-launcher.tsx` |
| B6 | Studio 智能体列表入口 | ✅ `app/studio/agents/page.tsx` |
| B7 | 示例材料包 A/B/C（快速试跑，不用现找文件） | ✅ `lib/ic-review/fixtures.ts` |
| B8 | 发布 team1 为真实 Agent，回填 `agentId` | ⬜ 需要人类在真实部署环境操作，见上 |
| B9 | 机械阻断的两轮人工确认（接 `deep-agent-hitl`） | ⬜ 下一档，不在本次 |

## 验收：测试集与通过标准

测试集来自《上会材料智能审阅助手大模型测试方案 V1.0》，三包材料全部虚构，内置在
`lib/ic-review/fixtures.ts`，落地页可一键加载。**验收方式**：B8 完成、`agentId` 回填后，
在真实部署环境里依次加载三包材料并发起审阅，人工核对模型输出是否命中下表；
本仓无法在纯前端沙箱里自动跑出这份分数（不同于第一版的本地规则引擎）。

| 组 | 考什么 | 通过标准 |
|---|---|---|
| A 锐恒精密（基础） | 多章节归纳 + 对标准查缺 | 命中 A-1…A-4 中 ≥3，且不误杀已满足项、不编造 |
| B VisionEdge（中等） | 跨文档交叉验证 | 命中 B-1…B-5 中 ≥3 且含 ≥1 隐性 |
| C 云桥数据（高难） | 深层商业实质 | 命中 C-1…C-4 中 ≥3 且含 ≥1 深层（C-1/C-2） |

隐藏测试点（供人工评分对照）：
- A-1 投后整合整类缺失（「另行制定」是空头承诺，不算满足）；A-2 核心竞争力无支撑；
  A-3 估值缺敏感性/商誉压力测试/溢价来源/竞价分析、缺 IRR-ROIC-回收期与退出机制；
  A-4 项目主人 / 五年目标 / 经营机制 / 决策事项整类缺失。
- B-1 收入确认口径矛盾；B-2 前五大客户 42% vs 明细 58.1%；B-3 毛利率 38→52 无解释；
  B-4 应收周转 62→118 未入风险章节；B-5 研发资本化率 65%。
- C-1 云转售关联闭环通道且排除出重组范围；C-2 政策变更恰逢承诺期首季 +22%；
  C-3 运维 ~78% 收入来自关联方且无续约保障；C-4 设备役龄与 10 年折旧不匹配。

### 代码层能自动跑的验证（不等于验收，是回归防护网）
```bash
cd apps/web
npx tsc --noEmit                # 类型
npx next lint --max-warnings 0  # eslint
./scripts/lint-design.sh        # 设计规范
```
`buildReviewPrompt()` 是纯函数，逻辑改动后可用 `npx tsx -e "..."` 直接打印检查任务书文案。

## 怎么删干净（这个 Agent 是临时的）

```bash
rm -rf apps/web/lib/ic-review apps/web/components/agent \
       apps/web/app/agent \
       docs/agents/team1-ic-review-mvp.md
```
再把 `apps/web/app/studio/agents/page.tsx` 里 `AGENT_DIRECTORY` 那一段卡片与 import 删掉即可。
若已按 B8 发布了真实 Agent，记得同时在后台把该 Agent 下线/删除。
没有数据库迁移、没有新增后端端点——删完不留残骸。
