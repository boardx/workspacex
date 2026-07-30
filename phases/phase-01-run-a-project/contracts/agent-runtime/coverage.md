# 契约束 `agent-runtime` — UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，如果有一条 UC 的验收线索找不到对应的接口，业务就是跑不通的。
>
> 覆盖 feature：**F48 F49 F50 F51 F52 F53 F54 F55 F56 F57 F58 F59 F60**（53 点）
> ⚠ **这一行是派生视图，不是权威。** 权威是 `design-signoff.md` frontmatter 的
> `covers:`（ADR-023 决策三）。改束的覆盖范围改那里，**不要**只改这一行。
>
> 验收线索来源：九份 UC 的 R12，共 **161 条**。

## 怎么读这张表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid` 或路由；
填不出来的标 `—（API 层验收）`，**但不能空着**。
本束的一大特点是**大量验收在服务端**（三条安全控制），所以 `—（API 层验收）` 会很多——
这不是偷懒，是这个束的性质。

---

## 一、`uc-20-1 接入并测试一个模型` R12（12 条）

⚠ 该 UC 的 R12 存在**编号重复**：`V8`–`V12` 各出现两次（第一轮是组合模型/价目表/provider/trace，
第二轮是权限/空态/不造数/并发/审计）。按规格**合并成一行**，两层语义都写进「一句话」列。

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：接入后能看到类型、厂商、能力标签、上下文窗口、单价、合规属性、五项结论与状态 | `registerModel` → `listSelectableModels` / 模型详情读 | `/admin/model` `admin-model-group-hosted` `admin-model-group-self` | ✅ |
| V2 | AC2：任一项判「不通过」即无法启用；直调接口置 `已启用` 被拒并记审计 | `enableModel` → `ADMISSION_TESTS_INCOMPLETE` | `/admin/model` `admin-model-test-submit`（五项全过前 disabled） | ✅ 见 I-1 |
| V3 | AC3：凭据不出现在任何响应、页面、日志、审计；能力维护者请求详情返回体不含凭据字段 | `registerModel` / 详情读的**响应 schema 无凭据字段**（I-6） | `/admin/model` `admin-model-panel`（掩码录入，无「查看」按钮） | ✅ 见 I-6 |
| V4 | AC4：按「欧盟数据驻留」筛选只返回带该属性的；按「开源自托管」筛选只返回自托管 | `listMcpServers` 同构的模型列表筛选 / `listSelectableModels(filter)` | `/admin/model` `admin-model-filters` | ⚠ **缺口 2**（合规属性枚举为空） |
| V5 | 把某项从「不通过」改判为「通过」，两次判读均可查、历史不被覆盖 | `recordAdmissionTest`（append-only） | `/admin/model` `admin-model-test-dialog` `admin-model-test-item` | ⚠ **缺口 3**（面板只有勾选，无三选+证据+历史） |
| V6 | 修改凭据或端点后状态自动回 `待测试`，且从 agent/skill 下拉中消失 | `configureModel` → `RETEST_REQUIRED` 语义 + `listSelectableModels` | `/admin/model` `admin-model-panel-save`；`/admin/agent` `admin-agent-field-model` | ✅ 见 I-2 |
| V7 | 把自托管端点置为不可达 ⇒ 模型转依赖失败态，已配它的 agent 明确失败而非静默换模型 | `probeConnectivity` → `MODEL_DEPENDENCY_FAILED`；`disableModel` 级联 | `/admin/agent?state=dep-failed`（七态外壳） | ✅ 见 I-16 |
| V8 | ①O-22③：模型池中创建组合记录（`whisper ＋ sonnet`），断言是**一条带独立 `model_id` 的记录**；成员未全过测则组合无法启用；停用组合 ⇒ 引用它的 agent 进依赖失败 ②权限态：七角色遍历，可读数据与可执行动作严格符合 R5 | `registerModel(shape:"composite")` / `enableModel` / `disableModel`；`listSelectableModels`（角色投影） | `/admin/model` `admin-model-group-hosted`；`/admin/agent` `admin-agent-field-model`；`?as=` 角色预览轴 | ✅ 见 I-3/I-5 |
| V9 | ①组合含一个闭源成员 ⇒ 判为**闭源链路**，在 UC-20.3 机密路由中被拒 ②空态：模型池为空显示真实空态与 `[＋ 接入模型]`，**不预置示例模型** | `routeModelCall` → `CONFIDENTIAL_ROUTE_VIOLATION`；`listSelectableModels` → `[]` | `/chat` `chat-approval-policy-violation`；`/admin/model?state=empty` `admin-model-add` | ✅ 见 I-4 |
| V10 | ①O-37：单价来自组织可配价目表（CNY），改价目表后预算估算随之变化，**不发起任何厂商价格同步请求** ②不造数：调用量列为空或「—」 | `registerModel(unitPrice)` / 预算估算读价目表；无 provider 价格同步端口 | `/chat` `chat-approval-card`（token 预算行）；`/admin/model` 无调用量列 | ⚠ **缺口 4**（价目表无编辑面） |
| V11 | ①O-40：替换转写 provider 配置后调用路径无需改代码即可切换；未配置 provider 时明确失败而非静默降级 ②并发态：两名管理员同时配置同一模型不静默覆盖 | `ModelProviderGateway` 端口（provider 抽象）；`configureModel` → `VERSION_CHANGED` | —（API 层验收） | ✅ |
| V12 | ①架构对齐：一次模型调用后 `provenance_events` 中存在含 `model_id`、prompt version、token、时延、结果状态的事件 ②审计态：接入/配置变更/测试判读/状态变更可按操作者、时间、模型检索；越权尝试也有安全审计 | `routeModelCall` → `ProvenanceWriter`；`queryRoutingDecisions` / `queryOrgAudit` | `/admin` `admin-overview-activity` `admin-activity-export` | ⚠ **缺口 5**（prompt version 无写入面） |

---

## 二、`uc-20-2 模型启用与可选范围` R12（15 条 → 14 行）

⚠ 该 UC 的 R12 用了 `V1a` / `V1b` 两个后缀编号。机械门控按 `V\d+` 归一，
故二者**合并为一行 `V1`**，两层语义（[原型] AC1a 与 [设计] AC1b/AC1c）都写进「一句话」列。

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V0 | O-22③：直接停用组合记录 ⇒ 从所有选择器消失、引用它的 agent 进依赖失败；停用成员 `whisper` ⇒ 组合自动不可选且**不降级为单模型静默运行** | `disableModel` → `COMPOSITE_MEMBER_DISABLED` | `/admin/model` `admin-model-disable-dialog`；`/admin/agent?state=dep-failed` | ✅ 见 I-5 |
| V1 | **V1a**［原型］AC1a：`待测试` 的模型**在下拉中不出现**；**V1b**［设计］AC1b/AC1c：启用后出现在 agent 与 skill 下拉、停用后立即消失，`未启用` **根本不出现**而非置灰 | `enableModel` / `disableModel` / `listSelectableModels` | `/admin/agent` `admin-agent-field-model` | ⚠ V1a ✅（见 I-2）；V1b 落**缺口 1**（「未启用也不出现」待人类裁决） |
| V2 | 服务端过滤：直接构造请求把 agent 的模型设为 `未启用` 模型 ID，接口拒绝并记审计 | `updateAgentDefinition` → `MODEL_NOT_SELECTABLE` | —（API 层验收） | ✅ 见 I-2 |
| V3 | AC2：停用一个正被 3 个 agent 使用的模型——停用前列出引用清单；停用后 3 个 agent 进依赖失败并停止被载入；**没有任何 agent 被自动改配** | `listModelReferences` → `disableModel` | `/admin/model` `admin-model-disable-dialog-impact` `admin-model-disable-dialog-inflight` | ✅ 见 I-16 |
| V4 | AC3：模型选择器上每个候选标出「闭源 API / 开源自托管」，机密场景下只列自托管候选 | `listSelectableModels(purpose:"confidential")` | `/chat` `chat-settings-models` `chat-approval-toggle-local` | ✅ |
| V5 | AC4：把某已启用模型的一项测试改判为「不通过」⇒ 自动退出 `已启用` 并从所有选择器消失，退出动作留痕 | `recordAdmissionTest` → 触发 `disableModel` 同一套级联 | `/admin/model` `admin-model-toast` | ✅ |
| V6 | 停用 `whisper` 后，配 `whisper ＋ sonnet` 的 agent 进入依赖失败态 | `disableModel` → `COMPOSITE_MEMBER_DISABLED` | `/admin/agent?state=dep-failed` | ✅ 见 I-5 |
| V7 | 停用最后一个自托管模型时出现强警告并列出将失效的机密场景 | `disableModel` → `LAST_SELF_HOSTED_MODEL` | `/admin/model` `admin-model-disable-dialog-impact` | ⚠ **缺口 6**（是否直接阻断 [待定]；文案须逐字说明后果） |
| V8 | 被停用的模型若是某蓝本【模型策略】三档之一 ⇒ 该蓝本标为「引用了已停用的模型」，新项目套用前须处置 | `listModelReferences.blueprintPolicies` | ⚠ **蓝本设计器【模型策略】面板未建**（归 02-tpl） | ⚠ **缺口 7** |
| V9 | 允许降级的任务类型在降级时，**替代模型也必须是已启用的**；无合格替代时明确失败 | `routeModelCall(degradedTo)` → `MODEL_DEPENDENCY_FAILED` | `/chat` `chat-badge-degraded` | ✅ |
| V10 | 权限态：七角色遍历符合 R5；非管理员请求不含凭据与端点 | `listSelectableModels` / 详情读的角色投影 | `/admin/model?as=` 角色预览轴 | ✅ 见 I-6 |
| V11 | [设计] 空态：无任何已启用模型时，agent/skill 的模型下拉显示真实空态（文案待定，**非原型原文**），**不预置默认值** | `listSelectableModels` → `[]` | `/admin/agent?state=empty` `admin-agent-field-model` | ⚠ **缺口 8**（空态文案未定稿） |
| V12 | 不造数态：调用量相关列为空或「—」，不出现编造的统计数字 | 无调用量统计端口（D-07 砍掉） | `/admin/model`（无调用量列）；`admin-sample-config-notice` | ✅ |
| V13 | 审计态：启用、停用、自动退出可按操作者、时间、模型、影响范围检索 | `queryOrgAudit` / `queryRoutingDecisions` | `/admin` `admin-overview-activity` | ✅ |

---

## 三、`uc-20-3 机密数据的模型路由` R12（18 条）

⚠ **本节整节的口径依赖 `domain.md` 待裁决 ①（D-U1 vs S-01）。** 表中按 UC-20.3 的裁决（整轮全本地）填。

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：含机密材料的调用实际选用模型必为开源自托管；直接构造请求指定闭源模型 ID 被服务端拒绝 | `routeModelCall` → `CONFIDENTIAL_ROUTE_VIOLATION` | `/chat` `chat-approval-datascope-note` | ⚠ **缺口 1**（口径待裁决） |
| V2 | AC2：停用全部自托管模型后发起含机密调用 ⇒ 明确失败与可读原因；**审计中不存在任何向闭源 API 的出站记录** | `routeModelCall` → `NO_LOCAL_MODEL_AVAILABLE`；`queryRoutingDecisions` 反向断言 | `/chat?state=dep-failed` `chat-approval-policy-violation` | ✅ 见 I-11 |
| V3 | AC3：含机密的批准卡显示「含机密，仅本地模型」；点 `[改]` 后候选**只有自托管**；提交闭源被拒 | `decideApproval(改参数再跑)` + `listSelectableModels(confidential)` | `/chat` `chat-approval-datascope-note` `chat-approval-reparam-panel` `chat-approval-toggle-local` | ✅ |
| V4 | AC4：组织级已达降级阈值时发起含机密调用 ⇒ **不降级**；超限走请人批准或明确失败 | `routeModelCall`（含机密 ⇒ 禁止降级分支） | `/chat` `chat-approval-card`（无 `chat-badge-degraded`） | ✅ |
| V5 | AC5：在「AI 读到了什么」中可只读审查系统提示，`# 硬约束` 段含「客户机密材料只能由本地模型处理」原文 | `assembleSystemPrompt` | `/brain`（14-brain 宿主，跨束） | ⚠ **缺口 9**（宿主屏归 14-brain） |
| V6 | AC6：反复尝试绕过路由，拦截次数在后台数据总览的「越权调用尝试」中递增 | `routeModelCall` 拒绝 → 拦截计数 | `/admin` `admin-overview-anomalies` | ✅ |
| V7 | 从严态：机密标记缺失或冲突时按含机密处理（走自托管） | `routeModelCall`（不确定 ⇒ 从严） | —（API 层验收） | ✅ 见 I-12 |
| V8 | 中途失败：自托管模型在调用中途不可达 ⇒ 本次调用失败，**不切换到闭源模型重试** | `routeModelCall` → `MODEL_DEPENDENCY_FAILED` | `/chat?state=dep-failed` | ✅ |
| V9 | 无豁免：以组织管理员身份尝试为某次调用开豁免 ⇒ 被拒绝并记审计 | `routeModelCall`（无豁免参数）→ `CONFIDENTIAL_ROUTE_VIOLATION` | —（API 层验收） | ✅ |
| V10 | 留痕态：每次调用有路由决策记录（是否含机密、依据、候选集、实际模型），且记录中**不含机密内容原文** | `queryRoutingDecisions` | `/admin` `admin-overview-activity` | ✅ 见 I-13 |
| V11 | 权限态：组织管理员/批准人/能力维护者/引导师/组员/观察者/未授权用户逐一验证符合 R5 | `queryRoutingDecisions` / `decideApproval` 的角色投影 | `/chat?as=` 四视角预览轴 | ✅ |
| V12 | 旁路检测：全量扫描代码中发起模型调用的路径，断言**没有任何一条绕过统一路由执行点** | 架构测试（依赖规则），非运行时 API | —（API 层验收） | ⚠ **缺口 10**（跨 `api-kernel` 门控面） |
| V13 | O-17 标记来源：上传不勾选 ⇒ 继承项目级默认值；显式勾选 ⇒ `is_confidential = true`；断言**不存在 AI 自动置位的代码路径** | 本束只**消费**标记（采集归 17-gov） | ⚠ **机密标记采集界面未建**（全部已探明屏内无该控件） | ⚠ **缺口 11**（跨 17-gov） |
| V14 | O-17 材料级粒度：含 1 份机密 + 3 份非机密时整次调用判为含机密；断言系统**未尝试**把材料切片分别路由 | `routeModelCall`（材料级判定，无分段路由代码路径） | —（API 层验收） | ✅ 见 I-10 |
| V15 | O-19 开关不可关：经界面与直调 API 两条路径尝试关闭「客户机密材料仅允许本地模型处理」⇒ **均被拒**并记审计 | `setSecurityPolicy(3)` → `POLICY_SWITCH_LOCKED` | `/admin/mcp` `admin-mcp-policy-toggle`（第 3 条只读常开） | ✅ 见 I-14 |
| V16 | O-22③ 组合记录：含闭源成员的组合在上下文含机密时**整条不可选**；断言系统不会自动拆出其本地成员单独运行 | `routeModelCall` + `listSelectableModels(confidential)` | `/chat` `chat-settings-models` | ✅ 见 I-4 |
| V17 | 架构对齐：机密标记从 `artifacts` 经 Version/Segment 传播进 Context Pack；路由读的是 Pack 内各 item 的 `artifactVersionId`，断言路由代码**未直连业务库另查一套标记** | `routeModelCall` 只依赖 `ContextApi` 端口 | —（API 层验收） | ⚠ **缺口 12**（跨 phase-00 `artifact`/`context-pack`） |
| V18 | 血缘：每次路由决策（含拒绝）在 `provenance_events` 中有一条 append-only 事件 | `routeModelCall` → `ProvenanceWriter` | `/admin` `admin-overview-activity` | ✅ 见 I-45 |

---

## 四、`uc-21-1 注册 MCP 服务器与授权范围` R12（19 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：注册一台服务器后清单显示端点、工具数、授权范围、连接状态四列 | `registerMcpServer` → `listMcpServers` | `/admin/mcp` `admin-mcp-list` | ✅ |
| V2 | AC2：新注册服务器状态为 `已隔离`；其工具不出现在 agent 白名单可选池；直接调用被拒并计入越权拦截 | `registerMcpServer` → `MCP_SERVER_ISOLATED` | `/admin/mcp` `admin-mcp-list`；`/admin` `admin-overview-anomalies` | ✅ 见 I-18/I-19 |
| V3 | AC3：授权范围设为 `仅项目负责人` ⇒ 普通顾问触发调用被拒且拒因指向第 ① 层；项目负责人触发则通过 | `setAuthScope` → `authorizeToolCall` → `AUTH_SCOPE_DENIED` | `/admin/mcp` `admin-mcp-scope-note` | ✅ 见 I-27 |
| V4 | 三层求交：授权范围放开但白名单里没有该工具 ⇒ 仍被拒；白名单里有但任务权限包里没有 ⇒ 任务阻塞并出现 `[去授权]` | `authorizeToolCall` → `EFFECTIVE_PERMISSION_DENIED` / `TASK_PERMISSION_MISSING` | `/tasks`（11-board 宿主的 `[去授权]`） | ⚠ **缺口 13**（第 ③ 层跨束） |
| V5 | AC4：通过 MCP 工具发起一次调用，审计中记录 `mcp:<服务器>.<工具>` 的函数签名、参数、命中数、运行态 | `recordToolCall` | `/chat` `chat-tool-call-row` `chat-tool-calls-detail` | ✅ 见 I-43 |
| V6 | AC5：服务器新增一个工具，重新发现后已有 agent 的白名单**不含**它，需人工添加 | `discoverMcpTools` → `added[]`（不写白名单） | `/admin/mcp` `admin-mcp-tools-list` `admin-mcp-tool-row` | ✅ 见 I-21 |
| V7 | 限流态：服务器置为 `限流中` ⇒ 调用方**明确收到限流告知**，不静默排队或丢弃 | `authorizeToolCall` → `MCP_RATE_LIMITED` | `/admin/mcp` `admin-mcp-list`（限流徽标）；`/chat` 调用链行 | ✅ |
| V8 | 不可达态：端点置为不可达 ⇒ 引用其工具的 agent 明确告知能力受限，**不静默跳过工具调用** | `authorizeToolCall` → `MCP_SERVER_UNREACHABLE` | `/admin/agent?state=dep-failed` | ✅ |
| V9 | 签名变更：修改某工具参数 schema ⇒ 引用它的白名单条目标为「签名已变更，需重新确认」，确认前不可用 | `discoverMcpTools.signatureChanged` → `TOOL_SIGNATURE_CHANGED` | `/admin/agent` `admin-agent-definition` | ⚠ **缺口 14**（白名单编辑器未探明） |
| V10 | 凭据与端点保密：以能力维护者身份请求服务器详情 ⇒ 返回体**不含端点与凭据**；界面亦不显示 | `listMcpServers` 的角色投影（**schema 无该字段**） | `/admin/mcp?as=` 角色预览轴 | ✅ 见 I-6 |
| V11 | 权限态：组织管理员/安全评审人/能力维护者/审核人/项目负责人/引导师/组员/观察者/未授权用户逐一验证符合 R5 | `listMcpServers` / `reviewMcpServer` / `setAuthScope` 的角色投影 | `/admin/mcp?as=` 角色预览轴 | ⚠ **缺口 15**（安全评审人不在现有角色枚举内） |
| V12 | agent 不能自扩权：模拟 agent 尝试注册或发现新 MCP 服务器 ⇒ 被拒绝并记安全审计 | `registerMcpServer` / `discoverMcpTools` → `AGENT_CANNOT_DISCOVER_MCP` | `/admin` `admin-overview-anomalies` | ✅ |
| V13 | 空态：清单为空时显示真实空态与 `[＋ 添加服务器]`，不预置示例服务器 | `listMcpServers` → `[]` | `/admin/mcp?state=empty` `admin-mcp-add` | ✅ |
| V14 | 不造数态：工具调用量区块为空或「—」，不出现编造的统计数字 | 无调用量统计端口（D-07） | `/admin/mcp`（无调用量区块）；`admin-sample-config-notice` | ✅ |
| V15 | 审计态：注册、工具发现、授权范围变更、状态变化可按操作者、时间、服务器检索 | `queryOrgAudit` | `/admin` `admin-overview-activity` `admin-activity-export` | ✅ |
| V16 | 血缘：一次 MCP 工具调用后 `provenance_events` 中存在对应事件（工具全名、调用者、agent、参数摘要、时间、项目）；该表 append-only，更新或删除被拒 | `recordToolCall` → `ProvenanceWriter` | `/chat` `chat-tool-call-row` | ✅ 见 I-45 |
| V17 | 留痕失败即调用失败：注入 `provenance_events` 写入失败 ⇒ 涉客户数据的工具调用返回明确失败而非静默成功 | `recordToolCall` → `PROVENANCE_WRITE_FAILED` | `/chat?state=dep-failed` | ⚠ **缺口 16**（适用范围口径两份 UC 不一致） |
| V18 | O-20 三字段正交：构造「`auth_scope=全体成员` ∧ `review_status=待安全评审` ∧ `connection_status=不可达`」的服务器，断言三字段**各自独立可查**，`不可达` 不被写成 `已隔离` | `listMcpServers`（三字段独立返回） | `/admin/mcp` `admin-mcp-list`（合并展示但字段独立） | ✅ 见 I-17 |
| V19 | O-19/O-01 保留期读参数：把「留痕保留期」从 180 天改为 30 天 ⇒ MCP 留痕到期时间随之变化，代码中**不存在硬编码 180** | `RetentionParams` 端口（本束只读） | `/admin/mcp` `admin-mcp-policy`（文案动态渲染） | ⚠ **缺口 17**（参数配置面归 17-gov） |

---

## 五、`uc-21-2 MCP 安全策略与放行评审` R12（18 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：新组织初始化后四个开关默认值为「开 / 开 / 开 / **关**」，与原型一致 | `getSecurityPolicy` | `/admin/mcp` `admin-mcp-policy` `admin-mcp-policy-toggle` | ✅ |
| V2 | AC1：逐条验证开关是**服务端控制而非展示**——关掉某可关开关后对应拒绝行为消失，开启后恢复 | `setSecurityPolicy` + `authorizeToolCall` 行为差分 | —（API 层验收） | ✅ |
| V2a | O-19 可关闭性：开关 1、2 关闭须管理员二次确认且留痕；开关 3 **任何路径都无法关闭**；开关 4 **无打开入口**，直调 API 打开被拒 | `setSecurityPolicy(confirmToken)` → `POLICY_SWITCH_LOCKED` | `/admin/mcp` `admin-mcp-policy-toggle` | ⚠ **缺口 18**（二次确认框未建） |
| V3 | AC2：新注册一台服务器 ⇒ 状态 `已隔离`、授权范围 `待安全评审`；工具不进白名单可选池；直接调用被拒并计入拦截计数 | `registerMcpServer` → `MCP_SERVER_ISOLATED` | `/admin/mcp` `admin-mcp-list`；`/admin` `admin-overview-anomalies` | ✅ 见 I-18 |
| V4 | AC5：注册人尝试自审被拒；放行时未设授权范围被拒；放行后状态转 `已连接` 且工具进入可选池；结论与理由不可删除 | `reviewMcpServer` → `SELF_REVIEW_FORBIDDEN` / `SCOPE_REQUIRED_ON_RELEASE` | `/admin/mcp` `admin-mcp-review-dialog` | ✅ 见 I-25/I-26 |
| V5 | 有条件放行：只放行部分工具时，未放行的工具仍不可用（若该粒度被采纳） | `reviewMcpServer(grantedToolIds)` | `/admin/mcp` `admin-mcp-tools-list` | ⚠ **工具级粒度 [待定]**，见 `domain.md` ⑧ |
| V6 | AC3：调用标注为涉客户数据的**服务器**上的工具 ⇒ 留痕含请求参数、返回摘要、调用者、agent、时间、项目，且落 `provenance_events`（append-only） | `recordToolCall` → `ProvenanceWriter` | `/chat` `chat-tool-call-row` | ✅ |
| V6a | O-19/O-01：把「留痕保留期」从 180 天改为 30 天 ⇒ 留痕到期时间与界面文案随之变化；代码中**不存在硬编码 180** | `RetentionParams` 端口 | `/admin/mcp` `admin-mcp-policy`（文案动态渲染） | ⚠ 同**缺口 17** |
| V7 | AC3：模拟留痕存储不可用 ⇒ 该次涉客户数据的调用**必须失败** | `recordToolCall` → `PROVENANCE_WRITE_FAILED` | `/chat?state=dep-failed` | ⚠ 同**缺口 16** |
| V8 | AC4：模拟 agent 尝试注册/发现/连接未登记的 MCP ⇒ 被拒绝并在后台数据总览的「越权调用尝试」中计数递增 | `registerMcpServer` / `discoverMcpTools` → `AGENT_CANNOT_DISCOVER_MCP` | `/admin` `admin-overview-anomalies` | ⚠ **执行证据原型确认缺失**（见缺口 19） |
| V9 | 叠加策略：即便开关 4 被打开（若允许），agent 发现的新服务器**仍为隔离态**，其工具依然不可用 | `registerMcpServer`（开关一优先） | —（API 层验收） | ✅ 见 I-18 |
| V10 | 机密委派：开关三开启时含机密的调用只走自托管模型（由 UC-20.3 执行）；验证开关与 UC-20.3 行为一致 | `getSecurityPolicy(3)` + `routeModelCall` 行为一致性断言 | `/chat` `chat-approval-datascope-note` | ✅ |
| V11 | 重新隔离：把已放行的服务器重新隔离 ⇒ 列出受影响的 agent 与进行中任务，进行中的调用被终止并明确失败 | `reIsolateMcpServer` | `/admin/mcp` `admin-mcp-disable-dialog` `admin-mcp-disable-dialog-impact` | ✅ |
| V12 | 最严降级：模拟策略服务不可用 ⇒ 系统按最严处理（视为全部隔离），**不放行** | `getSecurityPolicy` 失败路径的 fail-closed 断言 | —（API 层验收） | ✅ |
| V13 | 权限态：组织管理员/安全评审人/能力维护者/审核人/引导师/组员/观察者/未授权用户逐一验证符合 R5 | `getSecurityPolicy` / `reviewMcpServer` 的角色投影 | `/admin/mcp?as=` 角色预览轴 | ⚠ 同**缺口 15** |
| V14 | [设计] 空态：无待评审服务器时，待评审列表显示真实空态，不生成示例条目 | `listMcpServers(filter:{reviewStatus})` → `[]` | `/admin/mcp?state=empty` | ⚠ **缺口 8 同源**（文案未定稿，非原型原文） |
| V15 | 不造数态：工具调用量区块为空或「—」，不出现编造的统计数字 | 无调用量统计端口（D-07） | `/admin/mcp`；`admin-sample-config-notice` | ✅ |
| V16 | 审计态：策略变更、评审结论、放行、重新隔离可按操作者、时间、服务器检索 | `queryOrgAudit` | `/admin` `admin-overview-activity` | ✅ |

---

## 六、`uc-4-1 注册一个 Agent` R12（21 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：任取一个 `运行中` agent，能看到职责、挂载 skill（带版本）、三层求交后的实际数据范围、最近试跑结果 | `listAgents` + `explainEffectivePermission` + `trialRun` 结果读 | `/admin/agent` `admin-agent-list` `admin-agent-definition` | ⚠ **缺口 14**（行内无「数据范围」「最近试跑」两列） |
| V2 | AC2：未配工具白名单的 agent 提交发布被阻断并给出原型文案；直接调接口置为 `运行中` 被拒并记审计 | `submitForReview` → `TOOL_WHITELIST_EMPTY` | `/admin/agent` `admin-agent-definition-blocker` | ✅ 见 I-28 |
| V3 | AC3：只过安全扫描未过方法论审核的 agent 停在 `待审核`；白名单里存在未裁决的越权申请时不允许批准发布 | `approvePublish` → `METHODOLOGY_REVIEW_PENDING` / `ELEVATION_UNDECIDED` | `/admin/agent` `admin-agent-approve-dialog` | ✅ 见 I-29 |
| V4 | AC4 三层权限矩阵：①MCP 范围收紧 ⇒ 普通成员被拒 ②白名单移除工具 ⇒ 调不到（即使 MCP 仍开放）③任务风险升 R3 ⇒ 暂停等批准。三条各自独立生效且服务端可解释拒因 | `authorizeToolCall` + `explainEffectivePermission` | `/tasks`（第 ③ 层宿主）；`/admin/agent` `admin-agent-definition` | ✅ 见 I-27 |
| V5 | AC5：20-model 停用某模型后，agent 编辑页的模型下拉里它消失；已配该模型的 agent 转依赖失败态并停止被载入 | `disableModel` → `listSelectableModels`；`AGENT_DEPENDENCY_FAILED` | `/admin/agent` `admin-agent-field-model`；`?state=dep-failed` | ✅ |
| V6 | AC6：标为「仅能源组」的 agent 对平台组成员在库、编排面板、对话参与者、私聊四处均不可见，接口不返回其存在性 | `listAgents` / `openPrivateChat` → `AGENT_NOT_FOUND` | `/admin/agent?as=`；`/chat` `chat-team-panel` | ✅ 见 I-52 |
| V7 | 降级态：普通生成达阈值 ⇒ 自动降级且消息带 `降级运行 · sonnet` 标注；财务任务 ⇒ 先问人；含客户机密 ⇒ 禁止降级；无合格替代 ⇒ 明确失败 | `routeModelCall(taskKind)` 四分支 | `/chat` `chat-badge-degraded` `chat-approval-card` | ✅ |
| V8 | 不降级态：把某 agent 设为「不降级」，超限时**请人批准**而非降级 | `updateAgentDefinition(degradePolicy)` + `routeModelCall` | `/chat` `chat-approval-card` | ✅ |
| V9 | 复制态：复制一个现成 agent ⇒ 新 agent 记录 `clone_from`，且**工具白名单为空**（因此无法直接发布） | `cloneAgent` → 白名单 `[]` | `/admin/agent` `admin-agent-add` `admin-agent-definition-blocker` | ✅ 见 I-30 |
| V10 | 依赖失败态：把白名单引用的 MCP 服务器置为「已隔离」⇒ 该 agent 明确告知能力受限，不静默跳过工具调用 | `authorizeToolCall` → `MCP_SERVER_ISOLATED`；`AGENT_DEPENDENCY_FAILED` | `/admin/agent?state=dep-failed` | ✅ |
| V11 | 权限态：能力维护者/审核人/组织管理员/引导师/组员/观察者/未授权用户逐一验证符合 R5 | `listAgents` / `submitForReview` / `approvePublish` 的角色投影 | `/admin/agent?as=` 角色预览轴 | ⚠ 同**缺口 15**（能力维护者/审核人不在四角色枚举内） |
| V12 | 空态：Agent 库为空时显示真实空态与 `[＋ 新建 Agent]`，不生成示例 agent | `listAgents` → `[]` | `/admin/agent?state=empty` `admin-agent-add` | ✅ |
| V13 | 并发态：两名维护者同时改同一 agent 不静默覆盖，可识别最终版本 | `updateAgentDefinition` → `VERSION_CHANGED` | `/admin/agent` `admin-agent-panel-save` | ✅ |
| V14 | 审计态：发布、退回、白名单变更、越权申请裁决可按操作者、时间、对象、门禁结论检索；越权尝试也有安全审计 | `queryOrgAudit` / `queryAuditTimeline` | `/admin` `admin-overview-activity` | ✅ |
| V15 | O-22① 复制不继承权限：复制一个已配好白名单的 agent ⇒ 新 agent 白名单为空，且因此无法发布 | `cloneAgent` → `submitForReview` → `TOOL_WHITELIST_EMPTY` | `/admin/agent` `admin-agent-definition-blocker` | ✅ 见 I-30 |
| V16 | O-22② 并发排队：agent 级并发上限设为 1 并发起 3 个任务 ⇒ 后 2 个**进入排队**（显示位次），不被拒绝、不被丢弃；组织级额度耗尽时以更严者生效 | `enqueueAgentTask` → `{state:"queued", position}` | `/tasks`（运行中心，11-board 宿主）；`/chat` `chat-approval-queue` | ✅ 见 I-33 |
| V17 | O-22③ 组合模型属模型池：agent 的模型字段只接受**单个 `model_id`**；配两个被拒；`whisper ＋ sonnet` 作为一条组合记录可被选中 | `updateAgentDefinition` → `MODEL_ID_MUST_BE_SINGLE` | `/admin/agent` `admin-agent-field-model` | ✅ 见 I-3 |
| V18 | O-22④ 停用态：停用一个 `运行中` agent ⇒ 不再进可载入池、不出现在编制与私聊入口；**已锁版本的在跑项目不受影响** | `disableAgent` | `/admin/agent` `admin-agent-disable-dialog` | ✅ 见 I-32 |
| V19 | O-22⑤ 版本锁定：项目开工后修改 agent 定义并发布新版 ⇒ 该项目运行期内仍使用开工时锁定的版本；审计中可读出该版本号 | `lockAgentVersionForProject` + `replayAgentRun` | —（API 层验收） | ✅ 见 I-31 |
| V20 | O-21 两种审核职能：方法论审核人尝试裁决越权申请被拒；安全评审人尝试 `[批准发布]` 被拒；越权申请缺组织管理员会签时不生效 | `decideElevationRequest` / `approvePublish` → `WRONG_REVIEW_FUNCTION` / `COUNTERSIGN_MISSING` | `/admin/agent` `admin-agent-approve-dialog` | ⚠ 同**缺口 15** |
| V21 | O-23 三层求交不可放宽：白名单里有某工具但 MCP 授权范围未覆盖 ⇒ 调用被拒；任务权限包未包含 ⇒ 任务阻塞；**任何下层配置都无法放宽上层** | `authorizeToolCall` + `explainEffectivePermission` | `/tasks`（第 ③ 层）；`/admin/agent` `admin-agent-definition` | ✅ 见 I-27 |

---

## 七、`uc-4-2 按状态载入 Agent` R12（19 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：切议程环节后主持台显示当前载入了谁、**因什么载入**、下一环节将换成谁；每条载入记录可点开看触发事件与命中规则 | `evaluateLoadRules` → `loadedBecause[]` `nextSegmentPreview` | ⚠ **主持台无 AI 团队编排区**（需补画原型） | ⚠ **缺口 19** |
| V2 | AC5 裁剪态：构造同时命中 6 条规则的状态 ⇒ 只载入前 4 个，被裁剪的 2 个可在「本可载入但被优先级裁剪」中查到 | `evaluateLoadRules` → `prunedByPriority[]` | ⚠ 同上（无裁剪清单呈现） | ⚠ **缺口 19** |
| V3 | AC2 计数态：编制 6 个、其中 4 个在场 ⇒ 侧栏「AI 团队 · 6」、线程头部「团队 4」，两个接口字段分别返回且不混用 | `getThreadAiTeam` → `rosterCount` / `presentCount` | `/chat` `chat-team-panel` + `chat-header-team` | ✅ 见 I-34 |
| V4 | 三态：Ledger 触发后台任务时状态变为 `跑批中`，任务完成后回到本线程；切议程环节不强杀它 | `evaluateLoadRules`（`跑批中` 不换出）+ `enqueueAgentTask` | `/chat` `chat-team-panel`（三态徽标）`chat-approval-queue` | ✅ |
| V5 | AC3 项目权限态：关掉「AI 直接在小组画布落笔」⇒ AI 只能提交建议待接受；关掉「Facilitator 主动提议收敛」后行为立即停止；变更留痕且对成员可见 | `setProjectAiPermissions` | ⚠ **项目设置「AI 权限」屏未建** | ⚠ **缺口 7 同源** |
| V6 | 粒度态：agent 级已关插话但项目级已开时，**仍不插话**（收紧优先） | `getProjectAiPermissions.effective`（三粒度求交） | —（API 层验收） | ✅ 见 I-38 |
| V7 | AC4 改派态：提出需要行业数据库的问题 ⇒ 出现「这条更适合 Scout：它有行业数据库授权」；**不点 `[改派]` 则不改派**；把该 MCP 置为已隔离后建议不再出现 | `suggestRedispatch` / `applyRedispatch` | `/chat`（输入区上方改派条，归 `chat` 束） | ⚠ **缺口 20**（改派条 testid 未见于本轮 grep） |
| V8 | 可见性态：Ledger 标为「仅能源组」时平台组的项目无法载入它，规则命中亦被跳过并在主持台提示 | `evaluateLoadRules`（可见性过滤） | ⚠ 主持台提示位未建 | ⚠ **缺口 19** |
| V9 | 依赖失败态：把某规则引用的 agent 退回为 `待审核` ⇒ 载入时跳过并明确提示，**不静默换成别的 agent** | `evaluateLoadRules` → 跳过 + 提示 | `/chat?state=dep-failed` | ✅ |
| V10 | 实时降级态：断开实时通道 ⇒ 界面显示「非实时」与最后更新时间，不出现「已切换」的假象 | `getThreadAiTeam` → `stale{lastUpdatedAt}` | `/chat` `chat-team-panel`（非实时标注） | ⚠ **缺口 21**（「非实时」标注未见对应 testid） |
| V11 | 幂等态：同一状态事件重复投递 ⇒ 团队不重复载入、计数不翻倍 | `evaluateLoadRules(idempotencyKey)` | —（API 层验收） | ✅ 见 I-35 |
| V12 | 权限态：引导师/协同引导师/能力维护者/组长/组员/观察者/未授权用户逐一验证符合 R5 | `getThreadAiTeam` / `composeThreadTeam` 的角色投影 | `/chat?as=` 四视角预览轴（facilitator / groupLead / member / observer） | ✅ |
| V13 | 空态：线程无任何 agent 时显示真实空态与加入入口，不自动塞默认 agent | `getThreadAiTeam` → `roster: []` | `/chat?state=empty` `chat-team-market` | ✅ |
| V14 | 审计态：载入、换出、编制变更、AI 权限开关变更、改派可按操作者、时间、线程、触发事件检索 | `queryAuditTimeline` | `/admin` `admin-overview-activity` | ⚠ **缺口 22**（项目级审计屏未建） |
| V15 | O-23 三粒度求交：agent 级允许插话、项目级关闭 ⇒ 行为关闭；再在画布/线程级尝试打开 ⇒ **无法放宽**，仍关闭 | `getProjectAiPermissions.effective` | —（API 层验收） | ✅ 见 I-38 |
| V16 | **默认值未裁**：`requireValue(THRESHOLDS.projectAiDefault*)` **抛错**，界面显示「默认值未裁」而不是画成某个方向 | `getProjectAiPermissions`（新建默认 ⇒ 报未裁，不给值） | `/agent-runtime?screen=team` `team-ai-switch-default-pending` / `team-switch-pending-*` | ⚠ **待人类裁决**（O-23 只裁了合成规则；旧口径「默认全关」是伪造出处，2026-07-30 撤） |
| V17 | O-22④ 停用不进池：把某 agent 停用 ⇒ 从可载入池消失；已锁版本的在跑项目不受影响 | `disableAgent` + `evaluateLoadRules` | `/admin/agent` `admin-agent-disable-dialog` | ✅ 见 I-32 |
| V18 | O-22⑤ 锁版本载入：现场载入的是**项目开工时锁定的 agent 版本**，后台改动不影响运行期 | `lockAgentVersionForProject` + `evaluateLoadRules` | —（API 层验收） | ✅ 见 I-31 |
| V19 | O-22② 并发排队：并发已满时命中载入规则 ⇒ 任务**排队**并显示位次，不出现「载入失败」 | `enqueueAgentTask` → `{state:"queued", position}` | `/chat` `chat-approval-queue`；`/tasks` 运行中心 | ✅ 见 I-33 |

---

## 八、`uc-4-3 与单个 Agent 私聊` R12（16 条）

⚠ **本节整节的宿主界面是「原型确认缺失」**：对话屏已完整探明（左栏 AI 团队 / 中栏消息流 /
输入区 / 右栏五标签），**未见任何人与 agent 的私聊入口或面板**。档案中的「私聊」全部指人际私聊。

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：与某 agent 私聊后把一条结论转到主线程 ⇒ 主线程该条带完整出处（agent + skill 版本 + 时间 + 数据来源），且私聊内容未出现在主线程 | `openPrivateChat` → `transferConclusionToThread` | ⚠ **私聊面板未建**（需补画原型） | ⚠ **缺口 23** |
| V2 | AC2 提权态：私聊里请求不在白名单内的工具被拒绝；关掉项目级「AI 直接落笔」后私聊里也无法直接落笔 | `postPrivateMessage` → `EFFECTIVE_PERMISSION_DENIED` | —（API 层验收） | ✅ 见 I-40 |
| V3 | AC3 审计态：私聊中的每次工具调用都出现在 UC-4.4 的 tool-call 级审计里 | `recordToolCall`（私聊路径同写） | `/chat` `chat-tool-call-row` | ✅ |
| V4 | 隔离态：私聊消息不进入主线程的转录、洞察、产物三栏，也不计入线程消息数 | `getThreadAiTeam` / 主线程读的反向断言 | `/chat` `chat-team-panel`（计数不变） | ✅ 见 I-39 |
| V5 | 权限态：观察者无私聊入口且接口拒绝；组员默认不可私聊；引导师/协同引导师/组长/组员/观察者/未授权用户逐一验证符合 R5 | `openPrivateChat` → `PRIVATE_CHAT_DISABLED` / `ROLE_INSUFFICIENT` | `/chat?as=observer` / `?as=member` | ⚠ 同**缺口 23** |
| V6 | 可见性态：标为「仅能源组」的 agent 对平台组成员不可私聊，接口不返回其存在性 | `openPrivateChat` → `AGENT_NOT_FOUND` | —（API 层验收） | ✅ 见 I-52 |
| V7 | 依赖失败态：把该 agent 的模型停用 ⇒ 私聊明确失败或明确降级并标注，不静默换模型 | `postPrivateMessage` → `MODEL_DEPENDENCY_FAILED` / `degradedTo` | `/chat` `chat-badge-degraded`；`?state=dep-failed` | ✅ |
| V8 | 跑批态：与 `跑批中` 的 agent 私聊时给出明确提示与 `[看任务队列]` | `openPrivateChat` → `presence: "跑批中"` | `/chat` `chat-approval-queue`（同名入口） | ⚠ 同**缺口 23** |
| V9 | 换出态：私聊过程中该 agent 被换出编制 ⇒ 私聊不中断但提示「已不在在场名单」 | `evaluateLoadRules` + `openPrivateChat` 的独立性断言 | —（API 层验收） | ✅ |
| V10 | 空态：无可私聊 agent 时显示真实空态与下一步，不生成示例对话 | `getThreadAiTeam` → `roster: []` | `/chat?state=empty` `chat-team-market` | ⚠ 同**缺口 23** |
| V11 | 转出失败态：目标线程已归档时转出被拒并保留私聊内容 | `transferConclusionToThread` → `TRANSFER_TARGET_READONLY` | —（API 层验收） | ✅ |
| V12 | 审计态·全量：私聊发起、转出、工具调用可按操作者、时间、agent、skill 版本检索 | `queryAuditTimeline` | ⚠ 项目级审计屏未建 | ⚠ **缺口 22** |
| V13 | O-24 项目层归属：组织管理员读取私聊正文**成功**，同时产生一条审计事件且**对项目负责人可见**；管理员未持有该项目角色时行为相同（O-04） | `queryOrgAudit` + 管理员访问留痕 | ⚠ 项目负责人的「访问记录」面未建 | ⚠ **缺口 22 同源** |
| V14 | O-24 明示告知：私聊入口/面板显示「本对话属于本项目，可被审计」的提示 | `openPrivateChat` → `auditNotice` | ⚠ 私聊面板未建 | ⚠ 同**缺口 23** |
| V15 | O-24 组员开关：组员默认无私聊入口；引导师在本场打开开关后可用，该开关**逐场生效，不跨场继承** | `setMemberPrivateChatSwitch` | ⚠ 项目设置内的开关未建 | ⚠ **缺口 7 同源** |
| V16 | O-24 不改编制：发起私聊前后，线程的 agent 在场名单与计数**不变** | `getThreadAiTeam` 前后差分断言 | `/chat` `chat-team-panel` `chat-header-team` | ✅ 见 I-39 |

---

## 九、`uc-4-4 Agent 行为审计` R12（23 条）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1：任取一条 AI 结论，能追到当时的输入、注入的 skill（带版本）、逐条 tool-call 与调用链 | `drillDownAuditEntry` + `replayAgentRun` | `/chat` `chat-tool-calls-detail` `chat-approval-callchain-detail` | ⚠ **缺口 22**（下钻视图未探明） |
| V2 | AC2 粒度态：触发含三个工具调用的回答 ⇒ 审计里出现三条独立记录，各带函数签名、参数、命中数、运行态；`graph.search` 与 `mcp:行业数据库.query_market` 命名空间可区分 | `recordToolCall` / `getMessageToolSummary` | `/chat` `chat-tool-calls` `chat-tool-call-row` | ✅ 见 I-43 |
| V3 | AC3 互调态：让 Ava 调用 Ledger 执行需批准的动作 ⇒ 批准卡显示 `调用链 Ava → Ledger` 与 `已暂停`；审计生成 `Ava → Ledger · <任务名>（深度 N）· <token> · 人已批准` | `recordCallChainHop` + `decideApproval` | `/chat` `chat-approval-callchain-toggle` `chat-approval-callchain-detail` `chat-approval-status` | ✅ |
| V4 | 权限不继承：给 Ava 一个 Ledger 没有的工具授权 ⇒ Ledger 被调时**仍无法**使用，拒绝理由指向 Ledger 自身的三层权限 | `authorizeToolCall`（被调方独立求交）→ `EFFECTIVE_PERMISSION_DENIED` | —（API 层验收） | ✅ 见 I-47 |
| V5 | AC4 异常态：构造单人单日消耗达均值 11 倍的调用序列 ⇒ 产生 `[高]` 告警并**自动限速**；数据总览「异常待处理」计数增加；`[查看调用链]` 可下钻，`[标记为正常]` 需填理由并解除限速 | `listAnomalies` / `markAnomalyNormal` | `/admin` `admin-overview-anomalies` `admin-anomaly-chain-steps` `admin-anomaly-chain-step` | ✅ |
| V6 | 越权态：让一个自建 agent 反复访问未授权的 MCP ⇒ 调用**被拦截**且**计数递增**，产生 `[中]` 告警 | `authorizeToolCall` → `AUTH_SCOPE_DENIED` + 拦截计数 | `/admin` `admin-overview-anomalies` | ✅ |
| V7 | AC5 渲染态：审计时间线能渲染出与原型一致的条目形态（`11:20:33 调用 Ava → Ledger · 现金流对比（深度 2） 412k token · 人已批准`） | `queryAuditTimeline` | ⚠ **项目级审计与反馈时间线屏未建** | ⚠ **缺口 22** |
| V8 | AC6 硬前置：模拟审计写入失败 ⇒ 该次工具调用**必须失败**，不出现「调用成功但无留痕」 | `recordToolCall` → `PROVENANCE_WRITE_FAILED` | `/chat?state=dep-failed` | ⚠ 同**缺口 16**（适用范围口径待定） |
| V9 | 不可删态：对审计条目发起删除/修改请求一律被拒绝并记安全审计 | `queryAuditTimeline` 写路径 → `AUDIT_IMMUTABLE` | —（API 层验收） | ✅ 见 I-51 |
| V10 | 脱敏态：含敏感值的参数默认脱敏；有权者展开原值时该展开动作本身留痕 | `drillDownAuditEntry`（脱敏 + 展开留痕） | `/chat` `chat-tool-call-row`（参数列） | ⚠ **缺口 24**（脱敏与展开控件未建） |
| V11 | 管理员边界：管理员读某项目审计内容后，项目负责人能在「访问记录」里看到这次访问 | `queryOrgAudit` + 管理员访问留痕（D-18） | ⚠ 「访问记录」面未建 | ⚠ **缺口 22 同源** |
| V12 | O-01/O-19 保留期态：涉客户数据留痕在「留痕保留期」参数（默认 180 天）内可检索；超期按配置策略处理且有明确说明；代码中**不存在硬编码 180** | `RetentionParams` 端口 | `/admin/mcp` `admin-mcp-policy`（动态文案） | ⚠ 同**缺口 17** |
| V13 | 导出态：导出 CSV / JSON 内容与界面一致、可复现；大批量导出转异步并给回执 | `exportAudit` → `EXPORT_TOO_LARGE` / `asyncTaskId` | `/admin` `admin-activity-export` | ⚠ **缺口 22**（项目级导出按钮未建） |
| V14 | 权限态：项目负责人/组织管理员/能力维护者/引导师/组员/观察者/未授权用户逐一验证符合 R5 | `queryAuditTimeline` / `queryOrgAudit` 的角色投影 | `/admin?as=` 角色预览轴 | ⚠ 同**缺口 15** |
| V15 | 空态：无审计数据时显示真实空态与原因，不生成示例条目 | `queryAuditTimeline` → `[]` | `/admin?state=empty` | ⚠ **缺口 22** |
| V16 | 架构对齐 provenance 血缘：任一次 tool-call / 批准 / 越权拦截 / 限速动作后 `provenance_events` 中存在对应事件；对该表 UPDATE / DELETE **在表层面被拒绝** | `ProvenanceWriter` 端口 + 表层断言 | —（API 层验收） | ✅ 见 I-45 |
| V17 | 架构对齐 P4 四件套：一次 agent run 结束后 `agent_runs` / `agent_steps` / `context_packs` 中分别存在计划、工具调用与 checkpoint、Context Pack；重放能还原 `anchor` / `retrievalReasons` / `omissions` / `permissionDecisionId` | `replayAgentRun` | —（API 层验收） | ⚠ **缺口 25**（跨 phase-00 `context-pack`） |
| V18 | O-22⑤ 版本可回答：任取一条历史 AI 结论，能读出当时的 `agent_version` / `skill_version` / `model_id` 与三层权限快照；缺任一项即判审计不完整 | `drillDownAuditEntry` + `recordToolCall` 的必填校验 | `/chat` `chat-tool-calls-detail` | ✅ 见 I-48 |
| V19 | 架构对齐无旁路：架构测试断言 agent 与 skill 运行时**不存在**绕过 Context API 直查业务库 / 对象存储 / 向量库的代码路径 | 架构测试（依赖规则） | —（API 层验收） | ⚠ **缺口 10 同源** |
| V20 | O-36 异常阈值：把某人调用量推到 24 小时滚动窗口均值的 10 倍以上 ⇒ 触发额度异常并自动限速；**9 倍时不触发** | `AnomalyDetector` 端口 | `/admin` `admin-overview-anomalies` | ✅ |
| V21 | O-36 互调深度：构造深度 3 的 agent 互调 ⇒ 在第 3 层被终止并留痕 | `recordCallChainHop` → `CALL_DEPTH_EXCEEDED` | —（API 层验收） | ✅ 见 I-46 |
| V22 | O-21 会签：一条越权申请只有安全评审人签名、无组织管理员会签时 ⇒ 审计视图将其标为**流程不合规**且该白名单条目**不生效** | `decideElevationRequest` → `COUNTERSIGN_MISSING` | `/admin/agent` `admin-agent-approve-dialog` | ✅ 见 I-29 |
| V23 | O-01/O-19 保留期读参数：把「留痕保留期」从 180 天改为 30 天 ⇒ 涉客户数据留痕到期时间随之变化；审计事件按「审计保留期」1095 天独立计算；**快照与绑定关系不因任何保留期到期而失效** | `RetentionParams`（两个独立参数）+ 不可删对象豁免（O-39） | `/admin/mcp` `admin-mcp-policy` | ⚠ 同**缺口 17** |

---

## 十、缺口清单（这一件的真正价值所在）

> 这 25 条是**这一轮设计的产出**，不是失败。四件套的意义就是把它们在写代码之前找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **机密硬路由口径 D-U1 与 S-01 字面矛盾未解决**：UI mock 取「机密走本地 + 云端承接非机密」，`feature_list` F51 与 UC-20.3 取「整轮全本地」 | **需人类裁决（最高优先）** | 签核时裁决。`ui-preview/README.md` 自己把它列在「🔴 必须先定的」第一条与「建议优先核对的 5 处」第一条。改了要连带改 I-10 / I-4 / `modelPolicyViolation` / 二次确认文案 / F51 验收 |
| **2** | **合规属性枚举取值域为空**（O-38 外部输入） | 外部输入缺口 | 已按 O-38 做成受控枚举 + 从配置读取（I-8），**不阻塞编码**；枚举到手只改配置。V4 的验收在枚举到手前只能断言「筛选机制成立」而非具体取值 |
| **3** | **五项测试面板只有勾选，无三选 + 证据 + 判读人 + 历史** | 界面缺口 | 现有 `admin-model-test-item` 是布尔勾选；UC-20.1 要求「通过/不通过/不适用 + 证据 + 判读人 + 时间」，且改判留双份（I-7）。需补面板 |
| **4** | **单价价目表无编辑面**（O-37 组织可配、CNY、手工维护） | 界面缺口 | 归 `/admin` 组织配置平面；phase-1 可只做字段与录入路径 |
| **5** | **prompt version 无写入面**（AI gateway 八项职责第 4 项，`[设计]` 新增） | 契约缺口 | UC-20.1 R10 已说明：phase-1 至少把**字段与写入点**做出来（否则 UC-4.4「当时跑的是哪一版」无解），管理界面留 phase-2 |
| **6** | **停用最后一个自托管模型是否直接阻断 [待定]** | 需裁决 | 本文按「强警告 + 二次确认，不阻断」。⚠ O-19 关联：开关三不可关 ⇒ 该场景下含机密任务**确定性失败**，确认框须**逐字说明**该后果 |
| **7** | **蓝本设计器【模型策略】三档 + 蓝本第 12 项「Agent 编排」+ 项目设置「AI 权限」三屏未建** | 界面缺口（跨 02-tpl） | 归 02-tpl 束 / 项目设置面。本束的 V8（20-2）/ V5·V16（4-2）/ V15（4-3）都落在这三屏上。提一致性复核确认归属 |
| **8** | **多处空态文案「待定，非原型原文」** | 文案缺口 | 原型每屏都填满样例数据、**零空态**。UC 自己标注了「文案待定」。签核时给一批文案，或确认由实现者拟并回写 UC |
| **9** | **系统提示只读审查页归 14-brain** | 跨束 | V5（20-3）的宿主是「大脑 → AI 读到了什么」。本束只保证 `assembleSystemPrompt` 注入了硬约束段 |
| **10** | **「无旁路」只能靠架构测试**（V12/20-3、V19/4-4） | **契约管不到** | zod 管不了「没有第二条代码路径」。落成 `lint-arch-deps` 类的机械门控，归 `api-kernel` 束的门控面。⚠ 提一致性复核确认有人写 |
| **11** | **机密标记的采集界面不存在**（O-17 归 17-gov） | 跨阶段 | 全部已探明屏内**没有任何把材料标为机密的控件**。本束只消费标记；采集在 17-gov。phase-1 若无采集面，V13/20-3 无法端到端验收 |
| **12** | **机密标记沿 Artifact → Version → Segment → Context Pack 的传播** | 跨束（phase-00） | 与 phase-00 `artifact` 束缺口②（可见性沿数据链路传播）**是同一类问题的两条链路**，应合并设计，不要各查各的 |
| **13** | **三层权限第 ③ 层（任务权限包 R1/R2/R3）不在本束** | 跨束 | 第 ①② 层在本束、第 ③ 层在 00-core / 11-board。**三层是一个判定函数**，分两处实现即第 N 次「同一事实两处声明」。**必须提一致性复核** |
| **14** | **agent 工具白名单编辑器 + agent 行内「数据范围」「最近试跑」两列未建** | 界面缺口 | 白名单编辑器属「真·未探明」（补抽取）；行内两列属「原型确认缺失」（AC1 要求，需补画）。V1/V9（4-1）落在这里 |
| **15** | **角色枚举不含安全评审人 / 方法论审核人 / 能力维护者** | 跨束 + 需裁决 | `ui-preview/README.md` **S-02 / S-03** 已把同一问题提出来了（合规负责人、研究员/受访者也不在四值内），并建议**合并裁决「角色本体是否需要场景角色层」**。本束的 O-21 两职能拆分**依赖这个裁决**。⚠ 提一致性复核 |
| **16** | **`留痕写入失败 ⇒ 调用失败` 的适用范围两份 UC 口径不一致**：UC-4.4 R7 说**全部** tool-call，UC-21.2 E5 只说**涉客户数据** | 需裁决 | 本束按 UC-4.4 的严口径写 I-44。若取宽口径，I-44 与 V17/21-1、V7/21-2、V8/4-4 的断言都要改 |
| **17** | **「留痕保留期」/「审计保留期」参数的配置面归 17-gov** | 跨阶段 | 本束**只读**参数（I-24）。phase-1 若参数面未建，V19/21-1、V6a/21-2、V12·V23/4-4 只能在 API 层验证「读参数而非硬编码」 |
| **18** | **安全策略开关的二次确认框与「关掉会发生什么」说明未建** | 界面缺口 | 原型开关区四行**已完整渲染**，四行都只有一句文案 + 勾选框，**无任何确认或说明**——属原型确认缺失，需补画 |
| **19** | **主持台的「当前载入了谁 / 为什么 / 下一步换谁」面板不存在**（AC1 的载体）；「因什么载入」「下一环节提前提示」「静音全部主动插话」入口同样不存在 | 界面缺口（需补画，非补抽取） | 主持台全场视图**已完整探明，无任何 AI 团队编排区**。V1/V2/V8（4-2）全部落空。⚠ 这是 UC-4.2 最大的一块缺口 |
| **20** | **改派提示条无对应 `data-testid`** | 界面缺口 | 原型有该条幅，本轮 grep 未在 `apps/web/components/chat` 找到对应 testid。需确认是未建还是未打标 |
| **21** | **「非实时」降级标注无对应 testid** | 界面缺口 | E8 明确要求「必须显示『非实时』与最后更新时间，不得让引导师以为团队已切换」。需补 |
| **22** | **项目级「审计与反馈」时间线屏 + 组织级审计检索屏（D-34）+ 项目负责人「访问记录」面全部未建** | 界面缺口 | ⚠ **注意区分**：项目级审计屏在**原型里存在**（D-34「已存在，别搬走」），但**本仓 `apps/web` 里没建**；组织级检索屏**原型中就不存在**，需从零补画。F60 已标 `needs_ui_signoff` |
| **23** | **私聊入口与面板整体不存在** | 界面缺口（需补画） | 对话屏已完整探明，**未见任何人与 agent 的私聊入口或面板**；档案里「私聊」全指人际私聊。右侧滑出布局、skill 清单呈现、`[转到主线程]` 与出处预览**均需补画**，不是「回去再抽一次就有」。UC-4.3 整节 16 条验收都压在这上面 |
| **24** | **tool-call 参数的脱敏展示与权限门控展开（D-16）未建** | 界面缺口 | V10（4-4）落空。展开动作本身要留痕 |
| **25** | **agent run 四件套的 `context_packs` 表与重放能力跨 phase-00** | 跨束 | AC1「当时的输入」＝ 那次 run 的 Context Pack，属 phase-00 `context-pack` 束。本束只保证写入点与引用 |

---

## 十一、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `registerModel` | 20-1 V1 / V8 / V9 | ✅ |
| `configureModel` | 20-1 V6 / V11 | ✅ |
| `probeConnectivity` | 20-1 V7；五项第 1 项 | ✅（⚠ 是否纳入 phase-1 [待定]） |
| `recordAdmissionTest` | 20-1 V2 / V5；20-2 V5 | ✅ |
| `enableModel` | 20-2 V1b | ✅ |
| `listModelReferences` | 20-2 V3 / V7 / V8 | ✅ |
| `disableModel` | 20-2 V0 / V3 / V6 / V7 | ✅ |
| `listSelectableModels` | 20-2 V1a / V1b / V2 / V4 / V11；4-1 V5 / V17 | ✅ |
| `routeModelCall` | 20-3 V1–V4 / V7 / V8 / V14 / V16 / V18；4-1 V7 | ✅ |
| `assembleSystemPrompt` | 20-3 V5 | ✅ |
| `queryRoutingDecisions` | 20-3 V10；20-1 V12 | ✅ |
| `registerMcpServer` | 21-1 V1 / V2 / V12；21-2 V3 / V8 / V9 | ✅ |
| `discoverMcpTools` | 21-1 V6 / V9 / V12 | ✅ |
| `setAuthScope` | 21-1 V3 | ✅ |
| `reviewMcpServer` | 21-2 V4 / V5 | ✅ |
| `reIsolateMcpServer` | 21-2 V11 | ✅ |
| `getSecurityPolicy` / `setSecurityPolicy` | 21-2 V1 / V2 / V2a / V10 / V12；20-3 V15 | ✅ |
| `authorizeToolCall` | 21-1 V3 / V4 / V7 / V8；4-1 V4 / V10 / V21；4-4 V4 / V6 | ✅ |
| `requestTaskPermissionGrant` | 21-1 V4 | ✅ |
| `listMcpServers` / `listMcpTools` | 21-1 V1 / V10 / V13 / V14 / V18 | ✅ |
| `createAgent` / `cloneAgent` | 4-1 V9 / V12 / V15 | ✅ |
| `updateAgentDefinition` | 4-1 V8 / V13 / V17；20-2 V2 | ✅ |
| `mountSkill` | 4-1 V1（挂载 skill 带版本） | ✅ |
| `setToolWhitelist` | 4-1 V2 / V4 / V14 / V21 | ✅ |
| `explainEffectivePermission` | 4-1 V1 / V4 / V21 | ✅ |
| `submitForReview` | 4-1 V2 / V15 | ✅ |
| `decideElevationRequest` | 4-1 V3 / V20；4-4 V22 | ✅ |
| `approvePublish` / `rejectPublish` | 4-1 V3 / V20 | ✅ |
| `trialRun` | 4-1 V1（最近试跑结果） | ✅ |
| `disableAgent` | 4-1 V18；4-2 V17 | ✅ |
| `lockAgentVersionForProject` | 4-1 V19；4-2 V18 | ✅ |
| `listAgents` | 4-1 V1 / V6 / V11 / V12 | ✅ |
| `evaluateLoadRules` | 4-2 V1 / V2 / V4 / V8 / V9 / V11 / V17 / V18 | ✅ |
| `getThreadAiTeam` | 4-2 V3 / V10 / V13；4-3 V4 / V16 | ✅ |
| `composeThreadTeam` | 4-2 V12 / V13 | ✅ |
| `getProjectAiPermissions` / `setProjectAiPermissions` | 4-2 V5 / V6 / V15 / V16 | ✅ |
| `suggestRedispatch` / `applyRedispatch` | 4-2 V7 | ✅ |
| `openPrivateChat` / `postPrivateMessage` | 4-3 V1 / V2 / V5–V10 / V14 | ✅ |
| `transferConclusionToThread` | 4-3 V1 / V11 | ✅ |
| `setMemberPrivateChatSwitch` | 4-3 V15 | ✅ |
| `recordToolCall` | 4-4 V2 / V8 / V16 / V18；21-1 V5 / V16 / V17；21-2 V6 / V7；4-3 V3 | ✅ |
| `getMessageToolSummary` | 4-4 V2 | ✅ |
| `recordCallChainHop` | 4-4 V3 / V21 | ✅ |
| `decideApproval` | 4-4 V3；20-3 V3 | ✅ |
| `queryAuditTimeline` / `exportAudit` | 4-4 V7 / V9 / V13 / V15；4-2 V14；4-3 V12 | ✅ |
| `drillDownAuditEntry` | 4-4 V1 / V10 / V18 | ✅ |
| `queryOrgAudit` | 4-4 V11 / V14；4-1 V14；21-1 V15；21-2 V16；20-2 V13 | ✅ |
| `listAnomalies` / `markAnomalyNormal` | 4-4 V5 / V6 / V20 | ✅ |
| `replayAgentRun` | 4-4 V1 / V17 | ✅ |
| `enqueueAgentTask` | 4-1 V16；4-2 V4 / V19 | ✅ |

**48 个操作全部有 UC 要求，无孤儿接口。**

⚠ 反向也查出一件事：**没有任何 UC 要求「调用量统计报表」接口**——
这与 D-07 的砍项一致。因此**故意不提供**该端口，实现时相关列留空或「—」，
**不得为了填满界面而造数**（原型的「3,104 次/月」「工具调用量·近 7 天」不在 phase-1）。
⚠ **注意区分**：异常检测所需的**实时用量判据**属安全能力，由 `AnomalyDetector` 端口承载，**保留**。

---

## 十二、签核时请重点看这五处

1. **缺口 1（D-U1 vs S-01）** —— 唯一一条会直接造成**数据泄露语义错误**的口径矛盾，
   且 `ui-preview/README.md` 自己把它排在第一位待裁决。**不定这条，F51 无法开工。**
2. **缺口 13 + 15（三层权限第 ③ 层跨束、角色枚举缺三种职能）** —— 这两条合起来意味着
   **本束的权限内核有两块拼图不在本束**。它们必须在**阶段一致性复核**统一设计，
   否则会出现「agent-runtime 束签了，org-admin 束签的时候发现三层求交的前提不成立」。
3. **缺口 10（无旁路只能靠架构测试）** —— 这是**契约管不到的东西**，
   与 phase-00 `artifact` 束的缺口⑤（S3 写一次 / 灾备三源）同类。请确认这条门控有人负责，
   否则「唯一路由执行点」只是一句愿望。
4. **缺口 19 + 22 + 23（主持台编排区 / 审计三屏 / 私聊面板全部不存在）** ——
   合计压着 **4-2 的 3 条 + 4-3 的 16 条 + 4-4 的 6 条 ≈ 25 条验收**。
   它们不是「回去再抽一次原型就有」，是**需要从零补画**。这直接决定第 ① 件能不能签。
5. **缺口 16（留痕失败即调用失败的适用范围）** —— 两份 UC 口径不一致。
   宽口径会让每一次内建工具调用都被审计写入绑架（可用性风险），
   严口径会让部分调用「成功但无留痕」（审计风险）。**这是个真取舍，需要你定。**
