# Skill 深度升级 Backlog（目标：每个 skill 都是组织大脑的一个高质量容器）

> 创建于 2026-08-09。目标：每个 `.agents/skills/*/SKILL.md` 不再只是流程提醒卡，
> 而是承载**该模块的 SOP + 能力清单 + 架构知识 + 商业/领域知识**的活知识库，
> 经过深度研究（含外部开源最佳实践）与多轮自我批判迭代，逼近"10 分"标准。
>
> 硬约束（继承自 AGENTS.md，升级时不可违反）：
> - **不得制造第二份事实副本**——具体规则值（token/数字/门控条款）只能引用权威文件，
>   不能复述。这是本仓已经漂移过 6 次以上的模式，升级过程中最容易再犯。
> - 保留全仓统一的 description "关键词枚举 + 场景句"格式，不推倒重来。
> - `mod-_template` 是被锁死的脚手架，不在本 backlog 升级范围内。

## 打分维度（10 分制，每个 skill 升级后自评）
1. **SOP 完整性**（0-2）：从"何时用"到"怎么做"到"怎么验收"闭环，无缺步骤。
2. **能力清单**（0-2）：明确列出这个 skill 让 agent 具备哪些可执行动作/命令/检查点。
3. **架构知识**（0-2）：讲清这个模块在整个系统里的位置、依赖、边界。
4. **领域/商业知识**（0-2）：讲清"为什么这么设计"背后的业务动机、真实场景、外部最佳实践参照。
5. **可维护性**（0-2）：单一事实源干净、渐进式披露合理、经验回流机制清楚。

## 状态字段
`not_started` → `researched`（完成外部调研+架构梳理）→ `drafted`（完成第一版升级）→
`iterated`（完成至少一轮自我批判+修订）→ `scored`（打完自评分）

## Backlog（24 个 skill，按批次分组，排除 mod-_template）

### 批次 A — 协调治理核心
| skill | 状态 | 研究角度 |
|---|---|---|
| coordinator | iterated | 多 agent 编排 OSS 参照（如 AutoGen/CrewAI 的 supervisor 模式）；本仓 coord-service/D1 架构 |
| module-coordinator | iterated | 二级编排/领域负责人模式；本仓 registry.yaml + module-lock 架构 |
| architecture-coordinator | iterated | 治理/ADR 沉淀模式；跨平台 agent 协议设计参照 |
| harness-auditor | iterated | 系统健康度审计框架；控制变量实验方法论 |

### 批次 B — Feature 生命周期
| skill | 状态 | 研究角度 |
|---|---|---|
| requirement-author | iterated | Use Case 写作法、BDD/Gherkin 参照；spec_ref 机械门控架构 |
| feature-writing | iterated | Feature flag/粒度切分最佳实践；反模式库 |
| feature-implementer | iterated | TDD/契约先行开发法；范围纪律 |
| verification-writer | iterated | 端到端验证/防假阳性方法论；可执行断言设计 |

### 批次 C — Harness 运维
| skill | 状态 | 研究角度 |
|---|---|---|
| harness-workflow | iterated | monorepo 工程流程编排；本仓 harness CLI 全貌 |
| sprint-planner | iterated | 依赖拓扑排序/并行调度算法；敏捷 sprint 切分实践 |
| github-projector | iterated | 单向投影/CQRS 模式；GitHub Projects API 最佳实践 |
| adr-author | iterated | ADR 写作法（MADR 等开源模板）；决策记录治理 |

### 批次 D — 会话与设计
| skill | 状态 | 研究角度 |
|---|---|---|
| session-handoff | iterated | 长任务上下文交接模式；agent 记忆管理研究 |
| session-closer | iterated | 收尾检查清单设计；防幻觉完成判定 |
| ui-prototyper | iterated | UI-first 签核流程；design-to-code 工具链参照 |
| uiux-designer | iterated | shadcn/ui + Tailwind 设计系统最佳实践（开源组件库参照） |

### 批次 E — 产品域知识库（一）
| skill | 状态 | 研究角度 |
|---|---|---|
| mod-chat | iterated | 聊天产品架构（消息流/工具调用可见性）OSS 参照（如 Vercel AI SDK、LobeChat） |
| mod-agent-skill-runtime | iterated | Agent/Skill 运行时设计（对照 Claude Agent SDK、LangGraph） |
| mod-research-studio | iterated | 用户研究工具产品知识（访谈/录制/检索的行业实践） |
| mod-asset-artifact（原 mod-canvas-asset，2026-08-09 收窄让位官方 mod-canvas-diagram） | iterated | 白板/画布产品架构（对照 tldraw、Excalidraw 等 OSS） |

### 批次 F — 产品域知识库（二）+ Agentic 基础
| skill | 状态 | 研究角度 |
|---|---|---|
| mod-org-identity | iterated | 鉴权/组织建模最佳实践（对照 WorkOS、Clerk 等身份产品架构） |
| mod-coord-platform | iterated | Durable Object + 事件溯源架构（Cloudflare DO 官方模式） |
| mod-devportal | iterated | 开发者门户产品参照（对照 Backstage 等 OSS IDP） |
| agentic-development | iterated | Agent 系统设计模式（plan-act-observe、工具注册、记忆分层的 OSS 参照） |

## 迭代日志（每轮升级后追加一条）
- 第 1 轮 / 2026-08-09 / 批次 F / mod-org-identity+mod-coord-platform+mod-devportal
  三个骨架从代码地图补全「关键契约与不变量」「架构知识」「改动前检查点」，全部
  基于实测代码内联注释与 README，未编造踩坑经验（保持空，注明待回填）；
  agentic-development 从 origin/main 拉回已清理虚构包名的版本后补「架构知识：
  与 mod-agent-skill-runtime 分工」+「外部参照点」两节。发现 mod-coord-platform
  的一处真实事实源分裂：`packages/coord-protocol/src/types.ts` 注释里写的权威规格
  目录 `docs/coord-platform/protocol/` 在本仓不存在，已如实记录为已知落差而非
  新建该目录去填补。自评（5 维，0-2/项）：mod-org-identity SOP2/能力清单2/
  架构知识2/领域知识2/可维护性2=10；mod-coord-platform 2/2/2/2/2=10；
  mod-devportal 2/2/2/2/2=10；agentic-development 2/2/2/2/2=10。自我批判后
  给三个 mod-* skill 补了「改动前检查点」（此前能力清单维度依赖模板通用 SOP，
  偏叙事、不够可执行），是本轮唯一的修订项。
- 第 1 轮 / 2026-08-09 / 批次 C（harness-workflow / sprint-planner / github-projector / adr-author）/
  四个 skill 各补齐"能力清单 + 架构知识（工具链位置图 + 输入输出 + 下游消费者）+
  领域知识（本仓真实事故映射到外部 OSS/理论参照，含来源链接）+ 迭代/知识回流机制"，
  外部研究覆盖 monorepo 流水线（Turborepo/hook 实践）、拓扑排序+CPM 调度理论、
  CQRS/事件溯源单向投影、MADR 决策记录治理；写完按 5 维自评并做一轮自我批判
  （核对"能力清单"是否流于口号、"领域知识"是否只贴外部链接不落到本仓具体事故），
  确认无第二份事实副本（具体 token/参数值仍指针引用脚本与配置文件，不复述）/
  平均自评分 9.2/10（5 维：SOP 2 / 能力清单 1.8 / 架构知识 2 / 领域知识 2 / 可维护性 1.8）。
- 第 1 轮 / 2026-08-09 / 批次 A（coordinator / module-coordinator / architecture-coordinator /
  harness-auditor）/ 四个 skill 各补齐"能力清单 + 架构位置（谁派活/派给谁/依赖的下游
  服务/失效如何被感知恢复）+ 领域知识（本仓真实事故——双 coordinator 冲突、canvas/
  collab 缺乏所有权堆积安全问题、"全绿但空转"——映射到外部 OSS/方法论参照，含来源
  链接）+ 迭代/进化机制"；外部研究覆盖 AutoGen/CrewAI/LangGraph 的 supervisor/
  hierarchical/orchestrator-worker 模式、MADR 决策记录治理、MCP 开放协议设计哲学、
  SRE error budget/五个为什么/控制变量实验方法论。自我批判发现并修正一处真实漂移：
  architecture-coordinator 的启动仪式仍把已退役的 GitHub lease-label 心跳仪式描述成
  与 D1 module-lock "两种等价方式"，与 ADR-009（D1 是唯一协调权威）不符，已改为
  D1 为唯一裁定、GitHub 仪式明确标记退役。确认无第二份事实副本（loop 周期数字/WIP
  上限/门控条款细节均只引用 coordinator-sop.md 等权威文件，不复述具体值）/
  平均自评分 9.0/10（5 维：SOP 2 / 能力清单 2 / 架构知识 2 / 领域知识 1.8 / 可维护性 1.2，
  最弱维度可维护性——四个 skill 都新增了较长的知识性章节，长期看谁来保证这些新增段落
  本身不随协议再次演进而漂移，目前只靠"经手人回流"的软约束，弱于批次 C 的分数）。
- 第 1 轮 / 2026-08-09 / 批次 B（requirement-author / feature-writing / feature-implementer /
  verification-writer）/ 四个 skill 各补齐"能力清单 + 架构知识（在需求→feature→实现→
  验证→合并全链路里的位置图，标注上游输入/下游消费者/机械门控重新校验点）+ 领域知识
  （本仓真实教训——spec_ref 四元组补齐动机、自我背书反模式、PR #310/#311/#312 evidence
  事故、L4 迁移事故 PR #312、B-8 响应体契约教训——映射到外部方法论参照，含具体建议）+
  迭代/进化机制（照 mod-_template 回流规则风格，各补 append-only 的"迭代/进化机制"节）"。
  外部研究：Cockburn 用例写作法（fully-dressed use case，前置/主流程/异常流程/后置条件）
  与 BDD/Gherkin Given-When-Then 的结构同构性，提炼两条具体技法（Given-When-Then 顶一遍
  R3/R4 草稿、user goal vs summary 级别判断）写进 requirement-author；feature flag 五分类
  法（release/experiment/ops/permission/kill-switch）与 vertical slicing 实践，对比本仓
  feature 粒度标准与 notes 热点标注，写进 feature-writing；TDD red-green 循环与
  Design by Contract 的 precondition/postcondition/invariant 语言，对比本仓"先有
  verification 再实现"纪律，写进 feature-implementer；Kent C. Dodds 的 Testing Trophy
  与 mutation testing 思路（故意注入变异观察测试是否变红），对比本仓"先故意制造失败"
  手法与证据入库门控，写进 verification-writer。自我批判发现并修正一处技术性不准确：
  verification-writer 里 mutation testing 举例最初把"grep 不带 -q"的行为描述得不准确
  （原表述暗示不加 -q 会导致误判退出码，实际更常见诱因是管道吞掉前一命令的退出码，或
  断言表达式本身写错却从未跑过失败路径），已改写为更准确的诱因描述并给出具体变异动作。
  确认无第二份事实副本（spec_ref 解析规则、完成定义具体条款均只引用 AGENTS.md /
  spec-ref.ts / contract-design.md，不复述数字或条款原文）/
  平均自评分：requirement-author 9/10（SOP 2 / 能力清单 2 / 架构知识 2 / 领域知识 2 /
  可维护性 1，最弱维护性——新增章节量大，长期靠回流软约束）；feature-writing 9/10
  （同结构，可维护性 1）；feature-implementer 9/10（可维护性 1）；verification-writer
  9.2/10（可维护性 1.2，因为已把"手工检查清单未来如何被自动化工具收敛"写进迭代节，
  略优于其余三个）。四个 skill 共同的最弱维度是**可维护性**，与批次 A 的结论一致——
  新增知识性章节的长期新鲜度目前仍只靠"谁踩坑谁回流"的软约束，尚无机械门控能检测
  这些段落本身是否已经过时。
- 第 1 轮 / 2026-08-09 / 批次 D（session-handoff / session-closer / ui-prototyper /
  uiux-designer）/ 四个 skill 各补齐"能力清单 + 架构知识（在开发→收尾→交接、或
  设计→签核→实现链路里的位置图，标注与相邻 skill 的分工边界）+ 领域/商业知识（本仓
  真实事故——PR #310/#311/#312 evidence 空引用、2026-07-09 disabled 对比度架构事故、
  2026-07-10 字号档位三份副本漂移 ADR-013、mock 手写创造未评审后端契约——映射到外部
  研究/最佳实践，含来源链接）+ 迭代/进化机制（照 mod-_template 回流规则风格）"。
  外部研究：context rot/drift 不报错只悄悄失准、结构化交接（固定 schema）比自由摘要
  保留更多信息、"温启动"优于"冷启动"、生产系统常在 ~70% 容量前主动落盘（写进
  session-handoff/session-closer）；Figma "development-first components"、Storybook
  组件驱动开发（CDD）由小到大搭建、design-to-code 交接需要"一次清晰验收时刻"（写进
  ui-prototyper）；Radix "可访问性默认给但不是全给"、WCAG POUR 四原则作分类框架、
  公开审计显示 focus ring 对比度是高频问题类型（写进 uiux-designer，全程只讲审查
  思路不抄具体 token/class）。自我批判发现一处未修复的既有漂移（非本轮引入）：
  uiux-designer 遗留的"核心设计与交互准则"示例代码里 `disabled:opacity-50` 与
  uiux-standards.md §1.1 现行规则（禁止 disabled:opacity-*，须用 disabled:bg-disabled
  配对）直接矛盾——判断为超出"补强方法论"范围的既有代码修复，未在本轮直接改写，
  已用 spawn_task 单独派出（task_00fc670e）而非静默放过。四个 skill 确认无第二份新增
  事实副本（uiux-designer 新增内容全程零 token/类名字面量，只有 5 处指向脚本文件名
  的引用），且 session-handoff/session-closer 之间的方法论↔清单分工边界在本轮显式
  写清避免了两者继续各自演化出分歧。
  平均自评分：session-handoff 9.2/10（SOP 2 / 能力清单 2 / 架构知识 2 / 领域知识 2 /
  可维护性 1.2）；session-closer 8.8/10（架构知识 1.8——七项自检与权威 rubric 的
  投影关系本轮只是显式承认而未收敛为单一实现，留了轻微冗余；领域知识 1.8；可维护性
  1.2）；ui-prototyper 9.2/10（SOP 2 / 能力清单 2 / 架构知识 2 / 领域知识 2 / 可维护性
  1.2）；uiux-designer 9.0/10（可维护性 1.4——因主动发现并派出既有漂移的修复任务，
  高于批次平均，但未直接修完整问题故不给满分）。批次共同最弱维度仍是**可维护性**，
  与批次 A/B/C 结论一致，进一步印证"新增知识性章节缺乏机械新鲜度检测"是全仓层面
  尚未解决的结构性问题，而非某一批次的个例。
- 第 1 轮 / 2026-08-09 / 批次 E（mod-chat / mod-agent-skill-runtime /
  mod-research-studio / mod-canvas-asset）/ 开工前发现这 4 个骨架文件在本
  worktree 里实际不存在于工作区（虽然已在 `8eee328a`/#773 合入 `origin/main`），
  先用 `git show origin/main:<path>` 取回骨架再升级，未改动骨架本身的结构。
  四个 skill 各补齐"关键契约与不变量（每条标注实测出处：commit hash/文件路径/
  ADR）+ 架构知识（本模块在产品链路里的位置 + 依赖的相邻 mod-* + 外部 OSS 参照，
  含来源链接）"，"踩坑与经验"保持空并注明待回填（未编造）。实测代码而非猜测：
  chat 侧读了 `ad07baf0`/`99a1448e`/`d9561e71`/`0ad5582f` 四个真实 commit 与
  `apps/web/components/chat/ai-message.tsx` 的 `ToolCallLog` 字段设计；
  agent-skill-runtime 侧读了 `packages/contracts/src/agent-runtime.ts`/
  `context-pack.ts` 头部注释与 `apps/api/src/application/mcp/authorize-layer1.ts`
  的三层权限求交判定顺序；research-studio 侧读了 `consent-gate.ts`/
  `withdrawal-ports.ts` 的门禁口径与"只做触发不做物理删除"边界；canvas-asset
  侧读了 `docs/adr/ADR-100-fabric-markdown.md`/`VENDOR.md`/
  `packages/fabric-markdown/dist/model.d.ts` 的 DiagramModel IR 设计与
  `packages/contracts/src/asset-governance.ts` 的 phase-1/phase-2 范围裁决。
  外部研究：Vercel AI SDK `useChat` 的 `parts[]`/`tool-TOOLNAME` part 类型与
  四态状态机；MCP 官方 Skills-over-MCP 工作组对 skill 治理化的方向；Dovetail
  的转写-标签-聚合信息架构；tldraw 的 shape/store/ShapeUtil 数据模型与
  `@tldraw/sync` 协作同步——均标注来源链接，且明确写"不代表本仓已采用，只作为
  设计参照点"，不冒充本仓既有实现。自我批判：初稿"能力清单"维度偏弱（只靠模板
  通用 SOP 三步，没有本模块专属的可执行检查点），修订后给四个 skill 的 SOP
  第 3 步各补了实测确认的测试文件路径清单（chat: `apps/web/e2e/chat-*.spec.ts`
  等；agent-skill-runtime: `apps/api/tests/agent-runtime/` 等；research-studio:
  `apps/api/tests/itv/` 等；canvas-asset: `packages/fabric-markdown` 自身
  `vitest run` + `VENDOR.md` 改动清单同步义务）。确认无第二份事实副本——契约
  细节均以"实测 + 文件路径引用"呈现，不确定处（鉴权中间件复用规则、公开面
  清单、retrieval 排序实现、canvas 页面真实渲染入口等）均标注"待核实"未假装
  已知。平均自评分：mod-chat 9.2/10（SOP 2 / 能力清单 2 / 架构知识 2 / 领域
  知识 2 / 可维护性 1.2）；mod-agent-skill-runtime 9.0/10（可维护性 1.2——
  三层权限求交等强契约描述未来随契约演进需要人工跟进核对，无机械新鲜度检测）；
  mod-research-studio 9.0/10（可维护性 1.2，同理）；mod-canvas-asset 9.2/10
  （SOP 2 / 能力清单 2 / 架构知识 2 / 领域知识 2 / 可维护性 1.2，因补了
  VENDOR.md 同步义务这一具体机械动作而非纯叙事）。批次共同最弱维度仍是
  **可维护性**，与前四批结论一致。

- 第 2 轮 / 2026-08-09 / 全部 24 个 skill / 针对第 1 轮共同打出的最低分维度
  "可维护性"（新增知识性内容只靠软性回流约定，没有机械新鲜度检查）做了一次
  真正的机械化：新增 `pnpm harness skills doctor`（`.harness/scripts/skills-doctor.ts`
  + 纯函数判定逻辑 `.harness/scripts/lib/skill-doctor-model.ts`，13 条单测），
  扫描全部 SKILL.md 里反引号包住的仓库路径引用（含花括号列表的笛卡尔积展开），
  核实是否仍然存在。首次运行揪出 25 条失效引用，逐条排查后分两类处理：
  4 处是本仓从未存在过的教学用反例包名（`packages/agent-core` 等，标注
  `skill-doctor:ignore` 保留，因为"指出它不存在"正是那段话的重点）+ 1 处是
  coord-protocol 已知文档缺口（同样标注 ignore）+ 18 处是模板占位符
  （`phases/<phase>/...` 这类，改进提取器直接过滤，不需要逐条标注）；
  剩余 2 处是真实内容漂移（`mod-research-studio` 代码地图把 research/templates
  按统一三层描述，实测 research 只有 domain 层、templates 没有 infrastructure
  层）+ 1 处历史路径过期（`module-coordinator` 提到的一个具体页面路径已随
  重构不存在，改写为不依赖具体路径的通用描述）+ 1 处路径写错位置
  （`harness-auditor` 把 `feature_list.json` 错放进 `.harness/state/`，实际
  权威在 `phases/<phase>/`）——这 4 处才是"可维护性"薄弱这个自评结论的真实
  证据，现在已修正且有回归检查兜底。最终 `skills doctor` 对 25 个 skill、
  151 条路径引用跑绿（exit 0）。`pnpm harness skills doctor` 未覆盖"引用内容
  是否仍然准确"（只查路径存在性）与"PR 号/commit hash 是否仍有效"，如实标注
  在命令输出里，留给未来需要时再机械化。
