# 上会材料审阅 Agent（/agent/team1）— MVP backlog

> **临时 Agent，用完即删。** 走 ad-hoc 流程，不建 phase、不建 sprint、不进 feature_list。
> 本文件是这个 Agent 的**唯一文档**——需求、架构、backlog、验收标准、删除方式都在这里。

## 要解决的问题（HMW）

帮**投资分析人员**，在**集团投决会前项目分析**中，克服**资料分析工作量大、时间长**，
从而**快速识别资料问题，加速沟通与分析过程**。不是替人做投资判断——只把
「读材料 / 对标准查缺 / 找矛盾」的机械活拿走。

## 架构（2026-09-15 第四版 —— 方法论住进平台内置 Skill）

迭代过三版才到这里，每一版被推翻的理由都记在这：
- **第一版**：纯浏览器正则规则引擎 + 自建三栏工作区。零幻觉但也零智能，且和真实
  chat 是两套平行系统 → 人类要求复用 chat 的真实能力。
- **第二版**：材料真发进 chat，但 `agentId` 要运维手工发布 + 改 `deploy.env` +
  重新部署 → 人类要求「不用这么麻烦」「不要手工改数据库」。
- **第三版**：点击时按需自动发布 Agent，方法论塞在 Agent 的 `instructions` 里 →
  人类要求「接已有的 skills 来实现，而不是重新实现」。
- **第四版（当前）**：方法论是一个**平台内置 Skill**，随代码走、随 API 进程启动
  自愈种子，发起审阅时挂进线程。

```
/agent/team1（落地页 + 材料预处理）
        │  上传材料（PDF/DOCX/XLSX/PPTX 原样透传）
        ▼
1. ensure-agent.ts        按需解析/发布真实 Agent（org admin 点一次即可）
2. createPersonalThread   新建一条项目对话
3. updateAgentRoster      把 team1 Agent 挂进这条对话
4. mountSkills            把「上会审阅」Skill 挂进这条线程  ← 方法论在这
5. uploadAttachment       材料作为真实附件上传（服务端核验 MIME）
6. createMessage          只发一句「这次审哪些材料」的触发语
        ▼
跳转 /chat?thread=<id> —— 后续提纲/缺失清单/风险标注/两轮人工确认
全部在真实 chat UI 里发生，本仓不重画
```

### 方法论为什么是 Skill，不是 instructions

上会标准 IC-1…IC-8、交叉验证三分类、输出格式、两轮人工确认约定——这些是「怎么
审阅」，属于 Skill 正文。做成平台内置 Skill（`ic-review-standard`）之后：正文在
代码里（`apps/web/lib/ic-review/review-prompt.ts` 是唯一事实源，
`apps/api/scripts/ic-review-skill-content.ts` 原样 import），种子逻辑随 API 进程
启动自愈（`ensure-ic-review-skill.ts`，与四个官方 Office skill 同一条机制），
不再塞进 Agent 的 `instructions`、也不再每条消息重发一份。

**为什么不受运行时双人审核（`SELF_REVIEW_FORBIDDEN`/`NO_SECOND_REVIEWER`）约束**：
那条门审的是「用户在界面上临时提交的 skill 该不该被授予能力」；这个 skill 走的是
四个官方 skill 那条路——内容在代码里、随 git PR 走人类 code review、用迁移身份
直接写库。审核已经在「这段代码该不该合入仓库」那一步做完了，两道门审的是不同的
东西，不是绕过。

**为什么是线程级挂载而不是 `setAgentSkillPins`**：实测确认（真实 Postgres +
apps/api）`pg-agent-skill-pins-repository.ts` 的校验 SQL 是 `WHERE org_id = $1`
（agent 自己的组织），不含 `PLATFORM_ORG_ID`，平台组织下的 skill 一律
`SKILL_VERSION_NOT_FOUND`——四个官方 Office skill 同样钉不上去，它们本来也是走
线程挂载被用的。线程挂载实测可以挂平台组织的 skill。

`/agent/team1` 本身只有两件事：① 展示这个 Agent 是什么、能干什么、边界在哪；
② 把材料发进一条真实对话并触发审阅。**没有新增任何后端端点**，全部调用既有的真实
API（`lib/live-chat.ts` / `lib/live-skill-mount.ts` / `lib/agent-definition.ts`）。

## 已在真实环境验证过的部分（不是纸面设计）

2026-09-15，在一个真实起的 Postgres 16（含 pgvector）+ Redis + `apps/api`（无 mock、
无桩）实例上跑通了完整链路，每一步都是真实 HTTP/SQL，不是模拟：

| 步骤 | 实测结果 |
|---|---|
| Skill 种子（`ensureIcReviewSkillSeeded`） | 首跑 `created:true`，二跑 `alreadyExisted:true`（幂等）；库里 `skills.status=enabled`、`skill_versions.published=t`、`SKILL.md` 7926 字节 |
| API 进程启动自愈 | `main.ts` 启动日志打印 `ic-review skill: already existed` |
| 建 Agent + self-publish | `publishState: 运行中`，拿到真实 `agentVersionId` |
| Agent 挂进线程 roster | `rosterVersion: 1`，roster 里能读到这个 Agent |
| **Skill 挂进线程** | `mounts[0].versionId = skill-team1-ic-review-standard-v1` ✅ |
| **上传真实 PDF 附件** | `att-…`，服务端核验 `mime: application/pdf` 通过 |
| 发触发消息（带附件） | durable message 落库成功 |
| `setAgentSkillPins`（agent 级钉版本） | ❌ `SKILL_VERSION_NOT_FOUND` —— 正是这次实测发现的跨组织限制，据此改成线程级挂载 |

唯一没验证的是**真实模型对材料的实际输出质量**（该验证环境没配模型 provider 凭据，
AgentRun 停在 `queued`），这部分要在配了真实模型的环境里跑「验收」一节的测试集才能看到。

## MVP 边界

### 做（本次交付）
1. `/agent/team1` 落地页：能做什么 / 不做什么 / 上传材料 / 一键发起。
2. 材料预处理：按真实附件白名单预检（PDF/DOCX/XLSX/PPTX/txt/md/csv/图片/音频，
   单文件 25MB、单次 10 份，同 `chat-file-upload` 已签核上限），不在白名单/超限
   的单列清单，不静默跳过；通过预检的文件原样上传，不做本地内容解析或转换。
3. 审阅方法论做成平台内置 Skill，发起审阅时挂进线程；每条消息只发「这次审哪些材料」
   的触发语，方法论不重复发。
4. 跳转进真实 `/chat` 体验，复用它已有的全部能力（消息流、附件、审批卡、产物）。

### 明确不做（MVP 之外）
- ❌ 自建分析结果面板（提纲/清单/风险三栏）—— 复用 chat 消息流本身。
- ❌ 本地内容解析/预览 —— PDF/DOCX/XLSX/PPTX 原样作为真实附件上传，交给服务端
  `wx_document_parse`（页码/单元格级定位）实际解析；本页只做类型与大小预检，
  不在浏览器里读取或转换这些格式的内容（早期版本试过把二进制读成文本再重建
  File，PDF 会被 UTF-8 硬解破坏——已改掉，见 `intake.ts` 头注）。
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
3. **每个部署环境需要至少一位 org admin 点开过一次本页**（自动发布，见上），
   在此之前非 admin 用户会看到「需要管理员先点一次」+ 复制兜底，不假装能用。

## Backlog

| # | 条目 | 状态 |
|---|---|---|
| B1 | 上会标准清单 IC-1…IC-8（41 条） | ✅ `apps/web/lib/ic-review/standard.ts` |
| B2 | 材料接收：按真实附件白名单/大小预检 + sha256（原始 File 透传，不做本地内容解析） | ✅ `lib/ic-review/intake.ts` |
| B3 | 审阅方法论（标准 + 交叉验证 + 输出格式 + 两轮确认）做成**平台内置 Skill** | ✅ `lib/ic-review/review-prompt.ts`（单源）+ `apps/api/.../ensure-ic-review-skill.ts`（种子，随 API 启动自愈） |
| B4 | 发起真实对话：建线程 + 挂 Agent + **挂 Skill** + 传附件 + 发触发语 | ✅ `lib/ic-review/launch-review-thread.ts` + `ensure-agent.ts`（按需自动发布） |
| B5 | `/agent/team1` 落地页与材料预处理 UI | ✅ `app/agent/[teamId]` 的 team1 分支 + `components/agent/ic-review-launcher.tsx` |
| B6 | Studio 智能体列表入口 | ✅ 复用既有 `/agent` 六 team 列表页（#3666），未另建 |
| B7 | 示例材料包 A/B/C（快速试跑，不用现找文件） | ✅ `lib/ic-review/fixtures.ts` |
| B8 | 发布 team1 为真实 Agent | ✅ 按需自动发布（见上），链路已验证；⬜ 仍需在目标环境（devapp/生产）配好模型凭据，真实回复质量才能验证 |
| B9 | 机械阻断的两轮人工确认（接 `deep-agent-hitl`） | ⬜ 下一档，不在本次 |
| B10 | Agent 未初始化 / 非 admin 用户的可用性兜底：一键复制审阅任务书，手动粘进任意对话 | ✅ `ic-review-launcher.tsx` 的「复制审阅任务书」按钮 |

## 验收：测试集与通过标准

测试集来自《上会材料智能审阅助手大模型测试方案 V1.0》，三包材料全部虚构，内置在
`lib/ic-review/fixtures.ts`，落地页可一键加载。**验收方式**：在配好真实模型凭据的
部署环境里，用 org admin 账号打开一次 `/agent/team1`（自动完成发布），随后依次
加载三包材料并发起审阅，人工核对模型输出是否命中下表；本仓无法在纯前端沙箱里
自动跑出这份分数（不同于第一版的本地规则引擎）。

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
cd apps/web && npx tsc --noEmit && npx next lint --max-warnings 0 && ./scripts/lint-design.sh
cd apps/api && npx tsc --noEmit
```
`buildIcReviewSkillContent()` 是纯函数，改完可以 `npx tsx -e "..."` 直接打印检查正文。
⚠ 改 Skill 正文时**必须同步升** `apps/web/lib/ic-review/skill-identity.ts` 的
`IC_REVIEW_SKILL_VERSION_ID`（`-v1` → `-v2`）——种子函数会核对内容摘要，版本号没升
就带着新正文启动会 fail closed 报错，而不是让线上静默停在旧内容。

## 怎么删干净（这个 Agent 是临时的）

`team1` 是接进既有 `/agent/[teamId]` 六 team 路由（#3666）的一个分支，不是独立路由
（见架构一节），删除时不能整个删 `app/agent`——那是六个 team 共用的壳：

```bash
rm -rf apps/web/lib/ic-review apps/web/components/agent \
       apps/api/src/infrastructure/skill/ensure-ic-review-skill.ts \
       apps/api/scripts/ic-review-skill-content.ts \
       docs/agents/team1-ic-review-mvp.md
```
再删两处引用：
- `apps/web/app/agent/[teamId]/page.tsx` 里 `if (team.slug === "team1") { ... }` 那个
  分支（团队占位卡片会自动退回通用展示态），以及文件头关于 Team1 的那条注释；
- `apps/api/src/main.ts` 里 `ensureIcReviewSkillSeeded` 的 import 与那一段调用
  （刻意独立成一段，就是为了删的时候不牵连四个永久官方 skill 的种子逻辑）。

已经种进库的 skill 行与自动发布出来的 Agent 需要在后台下线/删除（Studio 后台的
Skill 目录里名字是「上会审阅」，Agent 列表里是「上会材料智能审阅助手」）。
没有数据库迁移、没有新增后端端点、没有环境变量——删完不留残骸。
