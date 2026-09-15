# 投后管理报告 Agent（/agent/team4）— MVP backlog

> **临时 Agent，用完即删。** 走 ad-hoc 流程，不建 phase、不建 sprint、不进 feature_list。
> 本文件是这个 Agent 的**唯一文档**——需求、架构、backlog、验收标准、删除方式都在这里。
> 验收评分口径另见 `docs/agents/team4-acceptance-rubric.md`（人类要求「自己定验收标准
> 并迭代到 9 分」的产物，由 `apps/web/scripts/team4-acceptance-score.mjs` 机械打分）。
> 需求参考材料在 `phases/phase-17-post-investment-report-agent/requirements/`
> （第一轮产出，**不是**开发的权威来源，本文件才是）。

## 要解决的问题（HMW）

帮**投后管理人员**，在**编制项目投后管理报告**中，克服**数据局限、行业分析欠缺、
风险识别滞后**，从而**优化财务分析与风险预警**。不是替人做投资/退出判断——只把
「读材料 / 算趋势 / 查外部信息 / 找风险」的机械活拿走。

## 架构（第四版 —— 就地挂 chat 壳 + 真的选中本 Agent）

四版演进，每一版都是被上一版的真实缺陷推着走的：

| | 第一/二版（已删） | 第三版（已改） | 第四版（当前） |
|---|---|---|---|
| 入口 | 自建粘贴框 / 上传框落地页 | 中转页 `replace` 进 `/chat/<id>` | **就地挂 `CopilotKitV2Shell`**，地址栏留在 `/agent/team4` |
| 谁在回答 | 专用端点（无 agent） | ❌ **通用助手**（本 Agent 没被选中） | ✅ 本 Agent（`initialAgentId` 交给选择 provider） |
| 材料 | 粘贴纯文本 | 真实附件，多份 | 同左（在 chat 里传，没有第二套上传框） |
| 方法论 | 后端 prompt 常量 | **平台内置 Skill**，挂进线程 | 同左 |
| 判据阈值 | 散在 prompt 里 | `post-investment-rules.ts` 单一事实源 | 同左 |
| 后端面 | 新增 `POST /post-investment/analyze` | 零新增端点 | 同左 |

### 第三版错在哪（2026-09-15 真机截图，这一版就是为修它）

截图里在这条对话问「你可以做什么」，回答的是**通用助手**的能力清单，没有投后方法论
的影子。根因不是模型表现差，是**本 Agent 根本没参与那次对话**：

1. 第三版把 Agent 挂进线程 roster 后 `replace` 进 `/chat/<threadId>`；
2. `/chat` 那棵树的 `CopilotKitV2AgentSelectionProvider` 初值恒为 `null`（界面上显示
   「能力：自动匹配」），且 `copilotkit-v2-panel.tsx` 明确写着"刻意不自动选中"；
3. 不选 ⇒ 请求不带 `COPILOTKIT_V2_SELECTED_AGENT_HEADER` ⇒ 服务端
   `resolveEffectiveAgentId`（`copilotkit-agui.controller.ts`）落到第 ③ 级「org 动态
   默认」= 通用助手。

**「挂进 roster」决定的是"这条线程编制里有谁"，不决定"这次请求用哪个 agent"**——
这两件事此前被当成一件。第四版就地挂壳并把 agentId 作为 `initialAgentId` 传给选择
provider（那个 prop 是本轮给公共组件加的，缺省 `null`，`/chat` 行为逐字不变）。

⚠ **team1 与 team3 同源**：它们也是"挂 roster + 打开 chat"，同样没把自己的 agentId
交给选择 provider。本轮只修了 team4（没动别人的 Agent），那两个要不要照修由它们的
负责人决定。

⚠ **还有一个叠加缺陷未修**：本 Agent 没有钉 skill（`agent_versions.skillVersionIds`
为空），于是 `message-roundtrip.ts` 的 `resolveRunSkillVersionIds` 会退化成加载**全
组织所有已启用 skill**（真机截图显示「技能活动 23 项」）——方法论 Skill 在里面，但
和另外 22 个挤在同一份 system prompt 里。修法是 `setAgentSkillPins` 钉一组（方法论 +
data-analysis + pdf-create/xlsx-create），但 `data-analysis` 没有稳定 skillId（随组织
导入生成），必须在真实环境按名解析；钉错会把本该有的能力挡掉，比现在更糟。所以本轮
**不做**，登记在 backlog B10，等能在真实环境验证时再做。

```
/agent/team4（中转页：能力清单 + 边界 + 转场提示）
        │  ① 按需解析/发布 Agent（ensure-agent.ts，走真实 POST /agents）
        │  ② 建或复用个人线程，把 Agent 挂进 roster
        │  ③ 把「投后管理报告」平台内置 Skill 挂进这条线程
        ▼
router.replace(`/chat/<threadId>`) —— 之后全部是普通 chat 操作：
  拖材料进对话 · wx_document_parse 解析 · data-analysis 沙箱算派生数值 ·
  受限渠道 web_search · pdf-create/xlsx-create 出报告 · 两轮人工确认 · 定向深挖
```

入口只做三件 chat 里做不了的事，做完就把人送进 chat；chat 已有的能力（附件、历史、
重试、产物落地、`#` 挂载浮层、子任务面板…）一律不重画。

### 方法论为什么住 Skill，而不是当第一条消息发

第二版把整份方法论作为会话第一条消息发出去，有三个实际问题：①每开一条对话就重发
一遍，占上下文；②它混在对话历史里，用户滚动时看到一大段"不是自己说的话"；③没有
版本，改了没法追。第三版把它铸成平台内置 Skill（`seedAdHocAgentSkill`，与 team1 共用
同一段 seeding 逻辑），挂在线程上，模型按它工作；正文变了必须升版本号，有
`apps/web/tests/team4-skill-content-pin.test.ts` 在 PR 阶段钉住。

### 单一事实源（改一处，不会漏第二处）

| 事实 | 唯一住处 | 消费方 |
|---|---|---|
| 风险判据阈值、派生公式、自检算例 | `packages/contracts/src/post-investment-rules.ts` | 方法论正文（渲染）、后端参照实现（import）、参照实现测试（遍历） |
| 方法论正文 | `apps/web/lib/post-investment/methodology.ts` | 内置 Skill 的 `SKILL.md`、非管理员降级时可复制的任务书 |
| Skill id / 版本号 | `apps/web/lib/post-investment/skill-identity.ts` | 前端挂载、后端 seeding |
| 落地页能力承诺 | `agent-directory.ts`（每条带 `evidence` 锚点） | 打分器机械核对"承诺在方法论里兑现" |

## 发布（按需自动，不用手工碰库/改部署）

`lib/post-investment/ensure-agent.ts` 在用户进入入口时按需通过真实前端 API
（`POST /agents` → `PATCH .../instructions` → `POST .../self-publish`）解析或创建 Agent，
跟 org admin 在后台手动建一个是同一条路径。幂等：按名字查，找到就复用。
Skill 侧由 API 进程启动时的 `ensurePostInvestmentSkillSeeded()` 自愈，不需要任何人跑脚本。

**第一个使用者**：org admin 直接就位；非 admin 撞 `ROLE_INSUFFICIENT` 时页面如实提示
「需要管理员先打开一次」并降级成「复制方法论」（粘进任意对话照样能用）。

## 验收

### 机械部分（本仓能自动跑）
```bash
node apps/web/scripts/team4-acceptance-score.mjs        # 功能性/可用性打分，口径见 rubric
node apps/web/scripts/team4-export-fixtures.mjs         # 导出 A/B/C 三包模拟材料
cd apps/web && npx vitest run tests/team4-acceptance-score.test.ts tests/team4-skill-content-pin.test.ts
cd apps/api && npx vitest run tests/post-investment      # 派生公式 + 自检算例同源
```

### 真实模型部分（必须在配了 provider 的环境里人工跑）
用上面导出的三包材料，逐组核对命中：

| 组 | 考什么 | 通过标准 |
|---|---|---|
| A 云帆智能 | 单份材料显性风险 | 命中 A-R01…A-R03 中 ≥2，数据引用与原文一致 |
| B 星瀚新材料 | 财务×合同×政策交叉验证 | 命中 B-R01…B-R05 中 ≥3 且含 ≥1 跨文件关联（B-R02/B-R04） |
| C 澜起生物医药 | 多源综合研判 + 退出前置条件 | 命中 C-R01…C-R06 中 ≥4 且含 ≥1 深层（C-R05/C-R06）；第③问只列前置条件不给退出结论 |

另需人工确认：附加项 C-R07（知识产权台账 2028 vs 正文 2038 自相矛盾）被指出而不是
挑一个当既成事实往下推。

### 已知限制（不要假装已解决）
1. **两轮人工确认是方法论约定，不是机械阻断**（同 team1）。真正的阻断要接
   `deep-agent-hitl`，不在本轮。
2. **真实模型输出质量本会话未验证**：后端 API 链路形状与 team1 同源、已在真实
   Postgres+Redis+apps/api 上验证过，但本 Agent 的方法论内容还没在配了模型 provider
   的环境里跑过测试集。打分器的满分**不代表**这一关会过。
3. 每个部署环境需要至少一位 org admin 打开过一次入口（之后所有人直接用）。
4. **skill 稀释未解决**（B10）：system prompt 里除了本方法论还有全组织另外约 22 个
   skill。第四版修的是"谁在回答"，不是"system prompt 里有几个 skill"。

## Backlog

| # | 条目 | 状态 |
|---|---|---|
| B1 | 判据阈值/派生公式/自检算例单一事实源 | ✅ `packages/contracts/src/post-investment-rules.ts` |
| B2 | 方法论正文（15 个测试点判据 + 硬边界） | ✅ `lib/post-investment/methodology.ts` |
| B3 | 铸成平台内置 Skill + 启动自愈 seeding + 内容钉版 | ✅ 与 team1 共用 `seedAdHocAgentSkill` |
| B4 | 中转页：建/复用线程 + 入编 + 挂 Skill + 进 chat | ✅ `ensure-thread.ts` + `post-investment-chat-entry.tsx` |
| B5 | 派生公式参照实现 + 真实数字单测 | ✅ `derive-financial-metrics.ts` + `tests/post-investment/` |
| B6 | 示例材料 A/B/C + 一键导出 | ✅ `fixtures.ts` + `scripts/team4-export-fixtures.mjs` |
| B7 | 验收标准 + 机械打分器 + 反证 | ✅ `team4-acceptance-rubric.md` + `scripts/team4-acceptance-score.mjs` |
| B8 | 真实模型链路跑 A/B/C（配了 provider 的环境） | ⬜ 见「已知限制」 |
| B9 | 机械阻断的两轮人工确认（接 `deep-agent-hitl`） | ⬜ 下一档 |
| B10 | 给 Agent 钉 skill（避免被全组织 23 个 skill 稀释），需真实环境按名解析 | ⬜ 见上方 ⚠ |

## 怎么删干净（这个 Agent 是临时的）

```bash
rm -rf apps/web/lib/post-investment \
       apps/web/components/agent/post-investment-chat-entry.tsx \
       apps/web/scripts/team4-acceptance-score.mjs \
       apps/web/scripts/team4-export-fixtures.mjs \
       apps/web/tests/team4-acceptance-score.test.ts \
       apps/web/tests/team4-skill-content-pin.test.ts \
       apps/api/scripts/post-investment-skill-content.ts \
       apps/api/src/application/post-investment \
       apps/api/tests/post-investment \
       packages/contracts/src/post-investment-rules.ts \
       docs/agents/team4-post-investment-report-mvp.md \
       docs/agents/team4-acceptance-rubric.md
```
再手工清三处：
1. `apps/web/app/agent/[teamId]/page.tsx` 的 `if (team.slug === "team4")` 分支、import
   与文件头关于 Team4 的注释（团队占位卡片会自动退回通用展示态）；
2. `packages/contracts/src/index.ts` 的 `postInvestmentRules` 导出；
3. `apps/api/src/infrastructure/skill/ensure-platform-skill-catalog.ts` 的
   `ensurePostInvestmentSkillSeeded()` 与两个 import，以及 `apps/api/src/main.ts` 里那次
   调用。**`seedAdHocAgentSkill()` 本身要留着**——team1 还在用它。

若已自动发布过真实 Agent，记得在后台把它下线/删除（名字是「投后管理报告 AI 生成单元」），
内置 Skill 同理（`skill-team4-post-investment-report`）。
没有数据库迁移、没有新增后端端点、没有环境变量——删完不留残骸。
