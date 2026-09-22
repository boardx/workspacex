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
- 2026-09-18：同一个 skill 在 devapp 两次超时（16 分钟）都不是脚本慢，是模型在跑脚本之前的动作：读 3 份
  references、`write_todos` 拆步骤、对截图 `ls`/`read_file`（PNG 已经是视觉输入，再读一次会撞 `tool_call_unresolved`）。
  产出文件类 skill 的 SKILL.md 要把"总共 3–4 次工具调用、不写 todo、图片不要再读文件"写成硬规则，速查表放正文里，
  references 只作备查（出处：issue #3729，`maau-venture-valuation`）。
- 2026-09-18：需要"确定性计算 + 固定版式 PDF"的 skill，不要让模型现场写 pdf-lib 脚本——把计算
  （`compute.cjs` 纯函数）和渲染（`render-report.cjs`）作为包内 `scripts/*.cjs` 随 starter pack 下发，
  SKILL.md 只让模型做"抽取结构化证据 JSON → 跑一条命令 → 核验 → `wx_artifact_publish`"。原生沙箱
  `NODE_PATH=/opt/sandbox/node_modules`（`session/provider.ts`），包内 CJS 脚本直接 `require('pdf-lib')`
  即可；同一份脚本在仓库根用 `pnpm maau:report` 本地跑（根 devDependencies 补了 `pdf-lib`/`@pdf-lib/fontkit`）。
  两个实测坑：① 中文字体里 U+2212 "−" 与 U+2022 "•" 可能缺字形成方框，报告里用 ASCII `-` 与画圆代替；
  ② 本机 `.ttc` 字体集 pdf-lib 拒绝嵌入，本地验证要先抽出单面 `.ttf/.otf`（出处：`skills/maau-diagnostics`）。
- 2026-09-13：平台文档 Skill 本身是 L0，不代表它派生的原生 `execute` 会自动继承等级；
  风险门看到的工具名仍是 L2 `execute`。继承只能建立在本 run 的钉版本风险快照、真实工具
  历史归因和整串命令 allowlist 三项同时成立时，任一缺失继续 fail-closed，不能把
  `execute` 全局降级（出处：issue #3590）。
- 2026-09-13：`fetch_url` 与 `browser_navigate` 同时暴露给通用模型时，工具描述或系统指令
  不足以保证“打开指定网页”走真实浏览器；上游反爬拒绝后模型可能反复 fetch，最后拿搜索
  摘录冒充页面原文。对“打开/交互/截图具体 URL”的首次模型调用应在 middleware 层确定性
  选择 browser_navigate，普通调研仍保留 fetch；导航之后恢复完整工具集。中间件只做路由，
  浏览器高风险授权仍由工具 HITL 决定（出处：issue #3582）。
- 2026-09-13：Playwright MCP 的 `browser_navigate` 响应本身已有页面 URL/标题；适配器若再
  自动拉一次完整 `browser_snapshot`，大页面会因快照越过契约字符上限，把已经成功的导航
  错记成 unknown outcome。导航只消费首个响应的元数据；显式快照超过上限时按完整行截断、
  显式标记，并在 opaque ref 替换后再次收口长度（出处：issue #3559）。
- 2026-09-12：自托管 runtime 的 PostgreSQL 就绪探针须覆盖异步图写入和重连恢复，只有 ledger 建表成功不足以证明图可运行。同步 PostgresSaver 接入 ainvoke 时需完整异步适配并持有连接；部署端口从镜像取值，替换旧容器前在同一网络完成探针（出处：issue #3498）。
- 2026-09-07：同一个通用单轮补全 provider 的子能力若另开可选 model-id override，读取器必须明确复用已配置的通用 model id，并保持专用 override 优先；只读新变量会让已有可用模型的部署误报 `MODEL_UNAVAILABLE`。两处 DI 消费必须共用一个配置读取器，两处都空才 fail closed（出处：issue #2941）。
- 2026-09-07：真实模型长链验收不能把 LangGraph 默认 `recursion_limit=25` 当成 25 次模型调用预算——当前中间件每轮会经过多个图节点，外层 recursion 可能先于 `ModelCallLimitMiddleware(run_limit=25)` 误杀，留下“25 次预算耗尽”的假归因。测试 runner 应把 recursion ceiling 设到明显更高，只让生产模型调用熔断器做权威边界，并用模型 callback 单独计数、断言 `<=25`（出处：issue #2930）。
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
- 2026-09-18：skill 产出的 PDF 体积直接决定 `wx_artifact_publish` 会不会超时——`maau-venture-valuation` 用 pdf-lib 整份嵌入 `NotoSansSC-Common.otf`（CFF，不能子集化）得到 6.7MB，devapp 上 publish 工具一直没返回（`tool_call_unresolved`），前 3 步都成功也白搭。改嵌 `/usr/share/fonts/workspacex/analysis/AnalysisSans.ttf` + `{subset:true}`（这份 TrueType 子集化实测正常：MuPDF 光栅化、fontTools 解析 488 个字形轮廓全部非空——Dockerfile 里"运行期子集器不可靠"那条只对 DroidSansFallback 与 CFF 成立），8 页压到 ~140KB；缺的希腊字母/数学符号按字符落到 StandardFonts.Symbol / Helvetica，判据读字体本身的 glyph id / 编码表而不是手写清单。教训：**沙箱里生成要发布的文件，先看字节数——超过 1MB 的字体嵌入就是发布链路的隐性超时**（出处：PR #3730 的 devapp 复现，本次修复 PR 见 `git log -- skills/maau-diagnostics/scripts/verify.ts`）。
- 2026-09-18：标准包升级只认同 `stable_name`——换了 stableName 的新版（`maau-diagnostics` 1.0.0 `maau-recursive-asset-report` → 2.0.1 `maau-venture-valuation`）会让新旧两个 skill 并排留在目录里，模型按 description 自选时可能挑到旧的。修法是 `SkillStarterImportRepository.retireSuperseded`：按血统（同 `pack_id` 的 succeeded 导入的 `skillIds`）下线本版不再发货的行，写 `skills.status` + `capability_listings.enabled` 两张表；在 `importSkillStarterPack` 成功后**单独跑，重放也跑**（改动部署前已装过新版的环境，只在首次落库那条路径下线永远轮不到）；重新发货即复活，且复活要放在「正文没变早退」之前。教训：**幂等种子只负责"有"，不负责"没有了"**——发货全集变小时，多出来的那部分需要一条独立的收敛步骤（出处：issue #3733）。

## 知识回流规则（本文件怎么迭代——这是这个 skill 存在的意义）

1. **谁干活谁回流**：在本模块交付 feature/修 bug/做 review 时，踩到新坑、建立新做法、
   推翻旧假设 → 在同一个 PR（或紧随的小 PR）往上方"踩坑与经验"**追加**一条：
   `- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`。append-only，不删旧条目
   （被推翻的旧经验标 ~~删除线~~ 并注明被哪条取代）。
2. **module coordinator 每 C-cycle 复盘**：检查本周期内本模块合并的 PR，有值得沉淀而
   没回流的，补写。
3. **结构变更**（新增章节/重组）走正常 review；追加"踩坑与经验"条目可随任意 PR 顺带。
4. 开源贡献者同权：任何人对本模块的经验修订都走 PR，以可验证事实为准，不看资历。
