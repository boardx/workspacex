# 投后管理报告 Agent（/agent/team4）— MVP backlog

> **临时 Agent，用完即删。** 走 ad-hoc 流程，不建 phase、不建 sprint、不进 feature_list。
> 本文件是这个 Agent 的**唯一文档**——需求、架构、backlog、验收标准、删除方式都在这里。
> 需求参考材料在 `phases/phase-17-post-investment-report-agent/requirements/`
> （前一轮产出，**不是**本次开发的权威来源，本文件才是）。

## 要解决的问题（HMW）

帮**投后管理人员**，在**编制项目投后管理报告**中，克服**数据局限、行业分析欠缺、
风险识别滞后**，从而**优化财务分析与风险预警**。不是替人做投资/退出判断——只把
「读材料 / 算趋势 / 查外部信息 / 找风险」的机械活拿走。

## 架构（第二版 —— 复用真实 chat，取代第一版独立粘贴框）

**第一版**（[#3679](https://github.com/boardx/workspacex/pull/3679)，已被取代）是一个
独立的 `/agent/team4` 粘贴框页面，直连新建的 `POST /post-investment/analyze` HTTP 端点，
只做单份文本的显性风险识别（测试方案的测试 A），不经过真实 chat、不能用附件/子任务/
产物/@提及等 chat 能力。人类要求"继续迭代一个可以用的版本，直接连接到 chatUI，可以用
chat 里面所有的能力，专注在 team4 的方案和场景"——于是改成同 team1/team2 的架构：

```
/agent/team4（落地页 + 材料预处理）
        │  上传材料 → 按需解析/发布真实 Agent（ensure-agent.ts）
        ▼
真实 chat 后端（deep-agent 内核 + AGUI 流式协议 + 真实模型）
  · createPersonalThread  新建一条项目对话
  · updateAgentRoster     把 team4 Agent 挂进这条对话
  · uploadAttachment      材料作为附件真实上传
  · createMessage         发一条任务书（投后报告标准 + 财务指标 + 风险判据 + 跨文件
                           交叉验证 + 受限渠道外部检索 + 报告产出要求）
        ▼
跳转 /chat?thread=<id> —— 财务分析/风险清单/外部对标/风险窗口时间轴/两轮人工确认/
定向深挖/pdf-create·xlsx-create 出报告，全部在真实 chat UI 里发生，本仓不重画，
可以用 chat 里全部既有能力（附件、审批卡、产物、子任务面板、@提及…）
```

`/agent/team4` 因此只有两件事：① 展示这个 Agent 是什么、能干什么、边界在哪；
② 把材料和一条写清楚了的任务书发进一条真实对话。**没有新增任何后端端点**，
全部调用既有 `lib/live-chat.ts` 的真实 API。

### 为什么这样改（对比第一版的取舍）

| | 第一版：独立粘贴框 + 专用端点 | 第二版：真实 chat |
|---|---|---|
| 材料形式 | 只能粘贴纯文本，单份 | 真实文件附件（PDF/DOCX/XLSX/PPTX/图片/音频），多份 |
| 能用的能力 | 一条固定 API 调用，没有工具循环 | chat 全部能力：`wx_document_parse`、`data-analysis` 沙箱、受限渠道 `web_search`、`pdf-create`/`xlsx-create`、`wx_knowledge_search`、子任务、审批卡 |
| 测试范围 | 只做测试 A（单份显性风险） | 任务书覆盖测试 A/B/C（含跨文件交叉验证、深层研判、退出前置条件） |
| 派生数值 | 服务端 TS 纯函数算（`derive-financial-metrics.ts`） | 任务书要求模型用 `data-analysis` skill 沙箱脚本算，同 team2 评分公式的纪律 |
| 人工确认关口 | 无 | 写进任务书让模型主动停下等确认（提示词约定，非机械阻断，同 team1 已知限制） |
| 与产品的关系 | 平行于 chat 的第二套系统 | 就是 chat 本身多一个可选 Agent，删除成本低（见下） |

第一版的契约束（`packages/contracts/src/post-investment-report.ts`）、用例
（`apps/api/src/application/post-investment/`）与 controller **未删除**，保留作为
派生数值计算（同比/资本化率等）的参照实现与验证面（同 team2 保留
`POST /postinvest-ratings/score` 的先例），但本页不再调用它。

## 发布 team4 这个 Agent（按需自动发布，不用手工碰库/改部署）

同 team1 第三版：`lib/post-investment/ensure-agent.ts` 在用户真正点「开始分析」时，
按需通过**真实前端 API**（`POST /agents` → `PATCH .../instructions` →
`POST .../self-publish`）解析或创建它，跟任何 org admin 在后台手动建一个 Agent
走的是同一条路径。幂等：按名字在当前组织里查，找到已发布的直接复用。

**每个部署环境的第一个使用者**：如果点击的用户是 org admin，直接就地创建并发布，
立刻可用；如果不是 admin（`ROLE_INSUFFICIENT`），页面会如实提示「需要一位组织
管理员先点一次」，并降级成「复制任务书」兜底。一旦任意一个 admin 点过一次，同组织
所有后续用户（含非 admin）直接复用同一个 Agent。

这条链路的真实 API 形状与 team1/team2 完全相同、已在真实环境验证过（见
`docs/agents/team1-ic-review-mvp.md`），本文件不重复验证同一条链路。

## MVP 边界

### 做（本次交付）
1. `/agent/team4` 落地页：能做什么 / 不做什么 / 上传材料 / 一键发起 / 三个示例材料包。
2. 材料预处理：按真实附件白名单预检，通过预检的文件原样上传，不做本地内容解析。
3. 把材料 + 一条结构化任务书（财务指标抽取 + data-analysis 沙箱算派生数值 + 三类
   风险判据 + 跨文件交叉验证 + 受限渠道外部检索 + 风险窗口时间轴 + 两轮人工确认
   约定 + 退出前置条件而非退出结论 + pdf-create/xlsx-create 出报告）发进一条真实
   项目对话。
4. 跳转进真实 `/chat` 体验，复用它已有的全部能力。

### 明确不做（MVP 之外）
- ❌ 自建分析结果面板 —— 复用 chat 消息流本身。
- ❌ 本地内容解析/预览 —— 交给服务端 `wx_document_parse`。
- ❌ 机械阻断的人工确认关口 —— 提示词约定，非机械阻断（同 team1 已知限制）。
- ❌ 未登录公开访问、归档模板、通知与定时（`wx_schedule_create` 仅在用户明确要求
  周期性报告时才由模型按任务书自行调用，本页不预先配置）。

### 已知限制（不要假装它们已解决）
1. **两轮人工确认是提示词约定，不是机械阻断。** 同 team1。
2. **真实模型的输出质量本会话环境内未验证。** 后端 API 链路已在 team1 那次真实
   Postgres+Redis+apps/api 验证中证明可用（建线程/挂 Agent/传附件/发消息），但本
   Agent 的任务书内容（财务判据/跨文件交叉验证/风险窗口时间轴）还没有在配了真实
   模型 provider 的环境里跑过测试集 A/B/C，命中率必须在那样的环境里跑一遍才知道。
3. **每个部署环境需要至少一位 org admin 点开过一次本页**才能自动发布，之前非
   admin 用户走复制兜底。

## Backlog

| # | 条目 | 状态 |
|---|---|---|
| B1 | 投后报告标准（财务指标 `PI-F-*` + 风险判据 `C-1…C-5` + 交叉验证 `D-*`） | ✅ 内嵌进 `lib/post-investment/analysis-prompt.ts`；权威定义在 `phases/phase-17-post-investment-report-agent/requirements/03-analysis-standard-and-evidence.md` |
| B2 | 材料接收：按真实附件白名单/大小预检 + sha256 | ✅ `lib/post-investment/intake.ts` |
| B3 | 投后报告任务书生成 | ✅ `lib/post-investment/analysis-prompt.ts` |
| B4 | 发起真实对话：建线程 + 挂 Agent + 传附件 + 发任务书 | ✅ `lib/post-investment/launch-analysis-thread.ts` + `ensure-agent.ts` |
| B5 | `/agent/team4` 落地页与材料预处理 UI | ✅ `app/agent/[teamId]` 的 team4 分支 + `components/agent/post-investment-launcher.tsx` |
| B6 | 示例材料包 A/B/C（测试方案原文，快速试跑） | ✅ `lib/post-investment/fixtures.ts` |
| B7 | 发布 team4 为真实 Agent | ✅ 按需自动发布；⬜ 仍需在目标环境配好模型凭据验证真实回复质量 |
| B8 | 机械阻断的两轮人工确认（接 `deep-agent-hitl`） | ⬜ 下一档，不在本次 |
| B9 | 派生数值确定性计算的参照实现（第一版遗留） | ✅ `apps/api/src/application/post-investment/derive-financial-metrics.ts`，任务书要求模型走 data-analysis 沙箱复现同一套规则 |

## 验收：测试集与通过标准

测试集来自《投后管理报告AI生成场景 — 大模型测试方案 V1.0》，三包材料全部虚构，内置在
`lib/post-investment/fixtures.ts`，落地页可一键加载。**验收方式**同 team1：配好真实
模型凭据的部署环境里，org admin 打开一次 `/agent/team4`（自动发布），依次加载三包
材料发起分析，人工核对输出是否命中下表。

| 组 | 考什么 | 通过标准 |
|---|---|---|
| A 云帆智能（基础） | 单份材料显性风险 | 命中 A-R01…A-R03 中 ≥2，数据引用与原文一致 |
| B 星瀚新材料（跨文件） | 财务×合同×政策交叉验证 | 命中 B-R01…B-R05 中 ≥3 且含 ≥1 跨文件关联（B-R02/B-R04） |
| C 澜起生物医药（深层） | 多源综合研判 + 退出前置条件 | 命中 C-R01…C-R06 中 ≥4 且含 ≥1 深层（C-R05/C-R06）；第③问只列前置条件不给退出结论 |

隐藏测试点：
- A-R01 增收不增利；A-R02 现金流由正转负；A-R03 研发资本化率 80% 远超行业。
- B-R01 客户集中度+合同单方终止权叠加；B-R02 存货激增×政策需求收缩（跨文件）；
  B-R03 关联采购价差 22%；B-R04 环保新规×产线未达标（跨文件）；B-R05 补助依赖度高。
- C-R01 入组滞后未披露原因；C-R02 现金跑道×里程碑缺口 8 个月（跨文件）；C-R03 竞品
  已获批进医保；C-R04 回购条款×进度无法支撑（跨文件）；C-R05 专利到期×商业化窗口
  错配（深层）；C-R06 CRO 变更暗示方案调整（深层）；附加项：知识产权台账日期
  自相矛盾（2028 vs 2038），只挑一个当既成事实即判失败。

### 代码层能自动跑的验证（不等于验收，是回归防护网）
```bash
cd apps/web
npx tsc --noEmit
npx next lint --max-warnings 0
./scripts/lint-design.sh
```
`buildAnalysisPrompt()` 是纯函数，可用 `npx tsx -e "..."` 直接打印检查任务书文案。

## 怎么删干净（这个 Agent 是临时的）

`team4` 是接进既有 `/agent/[teamId]` 六 team 路由的一个分支，不是独立路由，删除时
不能整个删 `app/agent`：

```bash
rm -rf apps/web/lib/post-investment apps/web/components/agent/post-investment-launcher.tsx \
       docs/agents/team4-post-investment-report-mvp.md
# 第一版遗留（若也要一并清理，非必须——保留作为参照实现无害）：
rm -rf apps/api/src/application/post-investment apps/api/src/interface/controllers/post-investment.controller.ts \
       apps/api/tests/post-investment packages/contracts/src/post-investment-report.ts \
       docs/adhoc/team4-post-investment-agent-mvp-backlog.md
```
再把 `apps/web/app/agent/[teamId]/page.tsx` 里 `if (team.slug === "team4") { ... }`
分支删掉，`apps/web/next.config.mjs` 里 `/post-investment` 的 rewrite（若第一版
端点也删了则一并删），以及文件头关于 Team4 的注释。若已自动发布过真实 Agent，
记得同时在后台把该 Agent 下线/删除（名字是「投后管理报告 AI 生成单元」）。
没有数据库迁移、没有新增环境变量——删完不留残骸。
