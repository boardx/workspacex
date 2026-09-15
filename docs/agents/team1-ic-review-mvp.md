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

## 发布 team1 这个 Agent（2026-09-15 已验证整条链路，脚本已备好）

`lib/ic-review/agent-directory.ts` 的 `agentId` 默认读 `NEXT_PUBLIC_TEAM1_AGENT_ID`
环境变量，没设时为 `null`。**每个部署环境（本机 / devapp / 生产）各自有自己的
Postgres，agentId 天然不跨环境通用**，所以这一步在每个新环境都要单独跑一次：

```bash
cd apps/api
API_BASE_URL=<该环境的 API 地址> \
API_LOGIN_EMAIL=<有 admin 角色的账号> \
API_LOGIN_PASSWORD=<密码> \
npx tsx scripts/publish-team1-agent.ts
```

脚本幂等：按名字查已有 Agent，存在就复用并刷新 instructions，不会重复创建。跑完把
打印出的 `agentId` 设进该环境的 `NEXT_PUBLIC_TEAM1_AGENT_ID`（或直接改
`agent-directory.ts` 里的字面量，本机临时验证更快）。

**这条链路本身已经在真实环境里验证过、不是纸面设计**：2026-09-15 在一个真实起
的 Postgres 16（含 pgvector）+ Redis + `apps/api`（无 mock、无桩）实例上，完整跑通
了 `POST /agents` → `PATCH .../instructions` → `POST .../self-publish` → 把发布出的
Agent 挂进一条真实线程 roster → 发一条真实审阅任务消息，拿到 `202` 与真实
`agentRunId`（durable message + queued AgentRun）。这证明 `launch-review-thread.ts`
调用的那一串真实 API 形状是对的、能跑通；唯一没验证的是**真实模型对材料的实际
输出质量**（那次验证环境没配模型 provider 凭据，AgentRun 停在 queued），这部分要
在配了真实模型的环境里跑「验收」一节的测试集才能看到。

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
2. **真实模型的输出质量还没验证过。** 后端 API 链路（建线程/挂 Agent/传附件/发
   消息）已在真实 Postgres+Redis+apps/api 上跑通，但那次验证环境没有配置模型
   provider 凭据，AgentRun 停在 `queued`——没有产生过真正的模型回复。命中率、
   幻觉率这些「验收」一节的指标，必须在配了真实模型的环境里跑一遍测试集 A/B/C
   才能知道。
3. **`agentId` 每个部署环境要单独发布一次**（脚本已备好，见上），没设时禁用按钮，
   落地页会如实说明，不假装能用。

## Backlog

| # | 条目 | 状态 |
|---|---|---|
| B1 | 上会标准清单 IC-1…IC-8（41 条，任务书用） | ✅ `apps/web/lib/ic-review/standard.ts` |
| B2 | 材料接收：读取 + sha256 + 可解析性判定 | ✅ `lib/ic-review/intake.ts` |
| B3 | 审阅任务书生成（标准 + 交叉验证要求 + 输出格式 + 两轮确认约定） | ✅ `lib/ic-review/review-prompt.ts` |
| B4 | 发起真实对话：建线程 + 挂 Agent + 传附件 + 发任务书 | ✅ `lib/ic-review/launch-review-thread.ts` |
| B5 | `/agent/team1` 落地页与材料预处理 UI | ✅ `app/agent/[teamId]` 的 team1 分支 + `components/agent/ic-review-launcher.tsx` |
| B6 | Studio 智能体列表入口 | ✅ 复用既有 `/agent` 六 team 列表页（#3666），未另建 |
| B7 | 示例材料包 A/B/C（快速试跑，不用现找文件） | ✅ `lib/ic-review/fixtures.ts` |
| B8 | 发布 team1 为真实 Agent，回填 `agentId` | ✅ 链路已验证（见上）+ `apps/api/scripts/publish-team1-agent.ts`；⬜ 仍需在目标环境（devapp/生产）实跑一次并配好模型凭据 |
| B9 | 机械阻断的两轮人工确认（接 `deep-agent-hitl`） | ⬜ 下一档，不在本次 |
| B10 | `agentId` 未发布前的可用性兜底：一键复制审阅任务书，手动粘进任意对话 | ✅ `ic-review-launcher.tsx` 的「复制审阅任务书」按钮 |

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

`team1` 是接进既有 `/agent/[teamId]` 六 team 路由（#3666）的一个分支，不是独立路由
（见架构一节），删除时不能整个删 `app/agent`——那是六个 team 共用的壳：

```bash
rm -rf apps/web/lib/ic-review apps/web/components/agent \
       apps/api/scripts/publish-team1-agent.ts \
       docs/agents/team1-ic-review-mvp.md
```
再把 `apps/web/app/agent/[teamId]/page.tsx` 里 `if (team.slug === "team1") { ... }`
那个分支删掉（团队占位卡片会自动退回通用展示态），以及文件头两条关于 Team1 的注释。
若已按 B8 发布了真实 Agent，记得同时在后台把该 Agent 下线/删除，并撤掉
`NEXT_PUBLIC_TEAM1_AGENT_ID` 环境变量。
没有数据库迁移、没有新增后端端点——删完不留残骸。
