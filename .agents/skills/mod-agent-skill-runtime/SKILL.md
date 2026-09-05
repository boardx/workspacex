---
name: mod-agent-skill-runtime
description: >
  Agent/Skill 运行时与相关 API 契约的活知识库：agent 定义/导入/运行、skill 装配、
  MCP 接线、模型路由、context-pack、provenance，以及 packages/contracts 里这些
  领域对应的契约单源。动手改 agent 运行逻辑、skill 持久化、工具调用协议或相关
  契约 schema 之前必读。
---

# Agent/Skill 运行时（mod-agent-skill-runtime） — 模块知识库

> 本文件是 agent-skill-runtime 模块的**单一经验沉淀点**：每模块一个 skill，让
> 任何开发者（人类或 agent）都能持续迭代模块的 SOP/技巧/知识结构。读完你应该
> 知道：代码在哪、什么不能破坏、前人踩过什么坑。

## 一句话定位
承载 agent 的定义/导入/运行与 skill 的装配/导入/持久化能力，以及支撑这两者的
MCP 接线、模型路由、context-pack、provenance；不含对话 UI 本身（见 [[mod-chat]]）。

## 代码地图
- API 领域：`apps/api/src/application/{agent,agent-run,agent-skill-pins,agent-import,skill,skill-import,mcp,model,context-pack,provenance}`
- API 基础设施：`apps/api/src/infrastructure/{agent,agent-run,skill,model,context-pack,provenance}`
- API 领域模型：`apps/api/src/domain/{agent,skill,model}`
- 页面：`apps/web/app/skill`、`apps/web/app/brain`、`apps/web/app/preview/agent-runtime`
- 契约单源：`packages/contracts/src`（`project.ts`/`context-pack.ts`/`provenance.ts` 等）——
  这是 API 契约的唯一权威，改字段先改这里，不要在 controller 里另起一套

## 关键契约与不变量（改代码前必读）
- **MCP 鉴权是分层的**：`apps/api/src/application/mcp/authorize-layer1.ts` +
  `authorize-agent-discovery.ts` 是两个独立的授权层——新增 MCP 相关端点前先确认
  自己该接哪一层，不要绕过两层直接在 controller 里写权限判断。
- **契约字段权威在 `packages/contracts/src`**：`agent-runtime.ts`、
  `agent-private-chat.ts`、`context-pack.ts`、`provenance.ts` 是这几个领域的
  schema 单源；改字段先改这里，`apps/api` 与 `apps/web` 都从这里导入类型，
  不要在某一端本地声明一份形状相近但独立维护的类型。
- <公开面/未登录可达的 agent/skill 相关端点清单——待核实>

## 架构知识
这是本仓 agent/skill 运行时的**真实代码地图**，和 `.agents/skills/agentic-development`
是分工关系：那个 skill 讲"这类系统一般怎么设计"（通用模式教学），这个 skill
讲"本仓具体怎么实现"（地图层）——写代码前的顺序永远是先读通用模式建立心智模型，
再落到这里的真实文件。外部参照：MCP（Model Context Protocol）把"工具/skill
注册与授权"作为协议的核心关切，本仓的两层 MCP 授权设计可以对照 MCP 规范里
"哪些能力需要显式 grant"的原则做审查。

## 关联阶段 / ADR / 文档
`phases/`（按当前 sprint 的 active-features.json 定位相关 feature）；
契约设计流程见 `.harness/instructions/contract-design.md`。

## 模块 SOP
1. 动手前：读本文件 + 对应 feature 的 `user_visible_behavior`/`verification`；跑
   `pnpm harness doctor --phase <相关 phase>` 确认没接手一个带审计债的现场。
2. 开发中：独立 worktree（ADR-005）；契约字段变更先改 `packages/contracts`，
   再改依赖它的 web/api 两端；敏感 area 主动挂安全 review。
3. 交付：`verify --sprint` 门控；PR 描述里写清对上述契约的影响面。

## 踩坑与经验（append-only，最新在上）
- 2026-09-05：把 `call_skill` 一刀切记成 L2 是把"调用 skill 这个动作"当成了风险
  单位，真正的风险单位是**被调用的那个 skill**——分级判断要接住"目标是谁"，不能
  只看"用了哪个工具"（`bash_exec`/三个具名虚拟工具确实是"工具本身即风险"，但
  `call_skill` 是"工具是通用的，风险在参数指向的目标"，两种工具的分级哲学不一样，
  别用同一套心智套所有工具）。修法：风险等级从"固定白名单"改成"按 skill 自身声明
  查表"，网关算完再把结论（本次 run 里哪些 skill 是 L2）投影给内核的
  `HumanInTheLoopMiddleware`——`InterruptOnConfig` 支持 per-call 的 `when` 谓词
  （langchain 1.3.15 实测），键缺席时谓词要 fail-closed 成"照旧每次都问"，不能
  假设"新键一定存在"（出处：issue #2767）。
- 2026-09-05：`decide-tool-permission.ts`（F06 四选一）写完之后，从来没有任何
  controller/路由真正调用过它，`PgToolPermissionGrantRepository` 也从没被注入
  `AgentRunExecutor`——"业务逻辑写完 = 能用"是假的，DI 图上一个节点没连，整条能力
  在生产里就是死码。加新用例后随手 `grep -rn <用例名> apps/api/src/interface` 确认
  真的有路由消费它，比事后靠人类实测发现"这功能从来没跑起来过"便宜得多（出处：
  issue #2767，`decideToolPermission`/`resumeAguiBridgeTurnToolPermission`）。
- 2026-09-05：`DeepAgentModelProvider.createRun` 的 resume 分支（HITL 批准后续跑）此前只转发
  `command.resume`，从不转发 `config.configurable.org_skills`/`script_protocol`——而
  `call_skill` 的技能来源是**这次请求自己的** `configurable.org_skills`（`tools.py` 的
  `_read_org_skills`，逐请求读取，不跨请求继承）。教训：**resume 是同一个 run 的"下一次"
  `ModelCallInput`，不是"上一次请求的延续"**——凡是执行工具调用需要读取的 per-run 数据
  （`org_skills`/`script_protocol`/`disable_task_auto_classify`），resume 分支必须与
  fresh-run 分支转发同一套，不能假设内核会记得上一次请求带过什么。这条 bug 活到 devapp
  才被发现，因为所有假 kernel 替身（loopback double）里 `call_skill` 的模拟从不真的依赖
  `org_skills` 内容作答，直接对真实 `langgraph dev` + `deepagents` 抓包对比两个只差
  这一个键的 resume 请求才看出差异（出处：issue #2768，PR #2777；回归测试见
  `deep-agent-resume-forwards-skills.test.ts`，用一个真实依赖 `org_skills` 内容才答对的
  假 kernel，不是硬编码"总是成功"）。
- 2026-09-05：给 deep-agent 内核"运行期"传一条新指令，只有一条现成通道——同一个 run 的**下一次** `ModelCallInput`（HITL 之后的 resume 续跑），投影到 LangGraph `config.configurable` 由 harness.py 中间件在 `before_model` 注入；`executeClaimed` 一次只发一次内核调用，run 不停顿就没有"下一次"，别假设网关侧消费=内核已收到（出处：issue #2755，F11 PR #2742 的范围边界）。
- 2026-09-05：`build_middleware()` 全栈跑假模型时，`TaskClassifierMiddleware` 会自己把多步任务钉成 `write_todos`、`RubricMiddleware` 的 grader 调用自带 `tool_choice="any"`——断言"某个中间件强制了 tool_choice"前先用 `disable_task_auto_classify` 隔离、并按 `bound_tools` 排除 grader 调用，否则正向与反证都在测别人（出处：`tests/golden/test_tc7_interjection_replan.py`，#2755）。

## 知识回流规则（本文件怎么迭代——这是这个 skill 存在的意义）

1. **谁干活谁回流**：在本模块交付 feature/修 bug/做 review 时，踩到新坑、建立新做法、
   推翻旧假设 → 在同一个 PR（或紧随的小 PR）往上方"踩坑与经验"**追加**一条：
   `- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`。append-only，不删旧条目
   （被推翻的旧经验标 ~~删除线~~ 并注明被哪条取代）。
2. **module coordinator 每 C-cycle 复盘**：检查本周期内本模块合并的 PR，有值得沉淀而
   没回流的，补写。
3. **结构变更**（新增章节/重组）走正常 review；追加"踩坑与经验"条目可随任意 PR 顺带。
4. 开源贡献者同权：任何人对本模块的经验修订都走 PR，以可验证事实为准，不看资历。
