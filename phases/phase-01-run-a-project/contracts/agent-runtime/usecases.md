# 契约束 `agent-runtime` — ② 用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 PostgreSQL、不知道 LangGraph。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。
> 覆盖 feature：**F48–F60** —— 派生视图，权威是 `design-signoff.md` 的 `covers:`

⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
本束的已建原型是 happy path 演示：UC-20.3 R8 逐字写着
「原型**没有任何错误态屏**（调用链只有『64 命中 / 复用 1 份 / 运行中』三态，无失败态）」。
**别继承这个缺陷。** 本束的价值有一大半在拒绝路径上——它是三条安全控制的载体。

---

## 统一失败枚举 `AgentRuntimeError`

前端据此渲染 R8 要求的七态之一（校验失败 / 依赖失败 / 无权限 / …）。
⚠ **同一种失败在 model / mcp / agent 三侧必须是同一个码**——本束跨三模块，
这是「错误语义是否一致」在束内就存在的风险。

### 通用（三侧共用）

| 码 | 场景 | 前端应显示 | 备注 |
|---|---|---|---|
| `NOT_ORG_ADMIN` | 非组织管理员执行管理动作 | 只有组织管理员可以做这件事 | 判定属 `org-admin` 束，此处透传 |
| `ROLE_INSUFFICIENT` | 角色不足 | 你的角色不能执行该动作 | R5 逐角色 |
| `SELF_REVIEW_FORBIDDEN` | 提交人 = 审核/评审人 | 不能自审自批，请指派其他评审人 | O-21；组织内无第二人时明确阻断 |
| `WRONG_REVIEW_FUNCTION` | 用错职能 | 该动作属另一种评审职能 | O-21：方法论审核人 ≠ 安全评审人 |
| `VERSION_CHANGED` | 并发修改 | 版本已变化，可刷新 / 对比 / 重新提交 | **不得静默覆盖** |
| `PERMISSION_REVOKED_MIDWAY` | 过程中权限被撤回 | 权限已变更，已终止后续写操作 | 已完成步骤按审计规则保留 |
| `DEPENDENCY_UNAVAILABLE` | 依赖不可用 | 依赖不可用，已保留当前输入与最后成功状态，可安全重试 | **保留用户当前输入** |
| `REQUEST_TIMEOUT` | 超时 | 请求超时，已保留输入，可安全重试 | |
| `PROVENANCE_WRITE_FAILED` | 留痕写入失败 | 操作失败：本次调用未能留痕，已中止 | **硬前置**，见 I-44。⚠ 适用范围待定，见 `domain.md` ⑫ |
| `AUDIT_IMMUTABLE` | 改/删审计条目 | 审计记录不可删除或修改 | I-51，并记安全审计 |

### 模型侧（`20-model`）

| 码 | 场景 | 前端应显示 | 备注 |
|---|---|---|---|
| `ADMISSION_TESTS_INCOMPLETE` | 五项未全过就启用 | 还差第 N 项未通过，无法启用 | I-1；**必须指出卡在哪一项** |
| `MODEL_NOT_SELECTABLE` | 选了未启用/待测试模型 | 该模型当前不可选 | I-2，接口层校验；前端**不展示**不可选项（不置灰） |
| `MODEL_ID_MUST_BE_SINGLE` | agent 侧配了两个模型 id | 一个 agent 只能配一个模型（组合请选组合记录） | I-3 / O-22③ |
| `COMPOSITE_MEMBER_DISABLED` | 组合成员被停用 | 该组合因成员「X」停用而不可用 | I-5；**不降级为单模型静默运行** |
| `MODEL_DEPENDENCY_FAILED` | 端点不可达 / 凭据失效 | 模型依赖失败，已停止被载入，请改选模型 | E3；**绝不静默换模型** |
| `NO_LOCAL_MODEL_AVAILABLE` | 含机密但无可用自托管 | 本次内容含客户机密，需本地模型处理，当前无可用本地模型，请联系管理员 | **I-11。这条错了等于数据泄露** |
| `CONFIDENTIAL_ROUTE_VIOLATION` | 尝试把机密送闭源 | 本次含机密，仅本地模型可选 | I-10；计入越权拦截计数 |
| `POLICY_SWITCH_LOCKED` | 尝试关开关三 / 开开关四 | 该策略不可更改 | I-14 / O-19 |
| `COMPLIANCE_ATTR_UNKNOWN` | 提交了配置外的合规属性 | 该合规属性不在受控枚举中 | I-8 / O-38 |
| `RETEST_REQUIRED` | 改凭据/端点后未重测 | 配置已变更，需重新测试后才能启用 | A2；状态自动回 `待测试` |
| `LAST_SELF_HOSTED_MODEL` | 停用最后一个自托管模型 | ⚠ 停用后所有含机密的任务将**确定性失败**——二次确认框必须逐字说明该后果 | E1；⚠ 是否直接阻断 **[待定]** |

### MCP 侧（`21-mcp`）

| 码 | 场景 | 前端应显示 | 备注 |
|---|---|---|---|
| `MCP_SERVER_ISOLATED` | 调用隔离态服务器 | 该服务器处于隔离态，不可调用 | I-19；**计入越权拦截计数** |
| `MCP_SERVER_UNREACHABLE` | 端点不可达 | 该服务器不可达，相关工具能力受限 | ⚠ **必须明确告知，不静默跳过工具调用** |
| `MCP_RATE_LIMITED` | `限流中` | 企业微信限流中，通知延迟 | E2；**不静默排队、不丢弃** |
| `AUTH_SCOPE_DENIED` | 授权范围外 | 你不在该服务器的授权范围内 | 三层第 ① 层；计入拦截计数 |
| `SCOPE_REQUIRED_ON_RELEASE` | 放行未设授权范围 | 放行必须同时设定授权范围 | I-25；不允许「已连接但范围未定」 |
| `TOOL_SIGNATURE_CHANGED` | 签名变更未确认 | 该工具签名已变更，需重新确认后才能使用 | I-22；**不自动接受新签名** |
| `AGENT_CANNOT_DISCOVER_MCP` | agent 自行发现 | agent 不能自行接入 MCP 服务器 | 开关四；计入拦截计数并记安全审计 |
| `REVIEW_REASON_REQUIRED` | 评审结论未填理由 | 评审结论必须填写理由 | 结论不可删除 |

### Agent 侧（`04-agent`）

| 码 | 场景 | 前端应显示 | 备注 |
|---|---|---|---|
| `AGENT_NOT_FOUND` | 不存在 / **可见性范围外** | 找不到该 agent | ⚠ I-52：范围外**返回 404 语义而非 403**，与真的不存在**不可区分** |
| `TOOL_WHITELIST_EMPTY` | 未配白名单就发布 | 还没配工具白名单，不能发布 | **[原型] 硬闸门**，逐字文案；直调接口置 `运行中` 亦被拒 |
| `ELEVATION_UNDECIDED` | 越权申请未逐条裁决 | 工具白名单里还有 N 条越权申请待确认 | 未裁决完不得批准发布 |
| `COUNTERSIGN_MISSING` | 越权裁决缺会签 | 越权申请需安全评审人 + 组织管理员双签 | I-29；缺签 ⇒ 条目不生效 + 审计标「流程不合规」 |
| `SECURITY_SCAN_PENDING` | 安全扫描未过 | 安全扫描尚未通过 | 双重门禁之一 |
| `METHODOLOGY_REVIEW_PENDING` | 方法论审核未过 | 等待方法论审核 | 双重门禁之二 |
| `EFFECTIVE_PERMISSION_DENIED` | 三层求交被拒 | 该操作被拒（**必须说明是哪一层**） | I-27；服务端可解释「为什么被拒」 |
| `TASK_PERMISSION_MISSING` | 第 ③ 层缺权限 | 阻塞：Echo 请求读取「客户 CRM」，权限包里没有 `[去授权]` | [原型] 逐字；**agent 不能自行加** |
| `AGENT_DEPENDENCY_FAILED` | 模型停用 / MCP 隔离或限流 | 该 agent 能力受限（原因逐条列出） | E3/E4；**不静默跳过工具调用、不静默换模型** |
| `AGENT_DISABLED` | 已停用 | 该 agent 已停用 | 已锁版本的在跑项目不受影响 |
| `CALL_DEPTH_EXCEEDED` | 互调深度 > 2 | 调用链深度超限，已终止 | O-36；**在第 3 层终止**并留痕 |
| `PRIVATE_CHAT_DISABLED` | 组员默认不可私聊 | 本场未开放组员私聊 | O-24；引导师**逐场**开关，不跨场继承 |
| `TRANSFER_TARGET_READONLY` | 目标线程已归档/只读 | 转出被拒，私聊内容已保留 | E4 |
| `TRANSFER_PROVENANCE_INCOMPLETE` | 转出缺出处 | 转出必须携带完整出处 | I-42 |
| `EXPORT_TOO_LARGE` | 导出量过大 | 已转为后台任务，完成后给下载回执 | 不阻塞页面 |
| `AGENT_MARKET_NOT_AVAILABLE` | 社区/外部市场导入 | 该能力在后续阶段提供 | D-06：phase-1 置灰标 later |

⚠ **不是错误码的两件事**（刻意建模为正常响应，别写成 error）：

- **并发超限 ⇒ 排队**（O-22②）：`enqueueAgentTask` 返回 `{ state: "queued", position, etaSeconds }`。
  拒绝会让现场直接失败，所以**它不是失败**。
- **降级运行**：普通生成任务达阈值时自动降级 ＋ **消息标注** `降级运行 · sonnet`，
  返回体带 `degradedTo: ModelId`。研究/财务/合规/决策辅助**先问人**（返回待批准），
  含机密**禁止降级**（走 `NO_LOCAL_MODEL_AVAILABLE` 或请人批准），
  无合格替代 **明确失败**（`MODEL_DEPENDENCY_FAILED`）。

---

# 用例 · A 组 · 模型池（F48–F51）

### `registerModel` —— UC-20.1 R3 步骤 1–3：接入一个模型

```
in:  { kind: "closed-api"|"self-hosted", shape: "single"|"composite",
       vendor, displayName, capabilityTags[], contextWindow, unitPrice,
       complianceAttrs[], credential?, endpoint?, members?: CompositeMember[] }
out: { modelId, status: "待测试" }
pre: 调用者是组织管理员
err: NOT_ORG_ADMIN | COMPLIANCE_ATTR_UNKNOWN | DEPENDENCY_UNAVAILABLE | REQUEST_TIMEOUT
```

落为 `待测试`（I-1 的前置）。凭据加密存储、**永不回显**（I-6）。
⚠ E2：凭据被拒时**不保存半截配置**。
⚠ 组合记录（`shape=composite`）的成员必须各自已通过测试，**组合本身还要再走一次五项测试**。

### `configureModel` —— A2：`[配置]` 修改接入参数

```
in:  { modelId, patch: {...}, expectedVersion }
out: { modelId, status }
pre: 组织管理员
err: NOT_ORG_ADMIN | VERSION_CHANGED | COMPLIANCE_ATTR_UNKNOWN | DEPENDENCY_UNAVAILABLE
```

⚠ **改凭据或端点 ⇒ 状态自动回 `待测试`**（`RETEST_REQUIRED` 语义），
并从所有模型下拉中消失（V6）。合规属性变更须留痕（它影响可选范围与机密路由）。

### `probeConnectivity` —— 五项第 1 项的真实探活

```
in:  { modelId }
out: { reachable: boolean, latencyMs, failureKind?: "credential"|"unreachable"|"timeout" }
err: NOT_ORG_ADMIN | DEPENDENCY_UNAVAILABLE | REQUEST_TIMEOUT
```

⚠ E1：失败必须给出**具体原因**，**不得把失败呈现为「待测试」而无说明**。
R9：10 秒内返回或明确超时。⚠ **是否纳入 phase-1 [待定]**（`domain.md` ⑫）。

### `recordAdmissionTest` —— UC-20.1 R3 步骤 5：五项人工判读记录

```
in:  { modelId, item: 五项之一, verdict: "通过"|"不通过"|"不适用", evidence }
out: { recordId, judgedBy, judgedAt }
pre: 组织管理员（**测试结论不可由使用方自填**）
err: NOT_ORG_ADMIN | DEPENDENCY_UNAVAILABLE
```

⚠ **append-only**（I-7）：改判**产生第二条**，历史不被覆盖（E4/V5）。
⚠ O-35：**不打分、不设分数线**，`evidence` **必填**。

### `enableModel` —— UC-20.2 R3 步骤 1

```
in:  { modelId }
out: { modelId, status: "已启用" }
pre: 五项全部「通过」（I-1）；组织管理员
err: NOT_ORG_ADMIN | ADMISSION_TESTS_INCOMPLETE | COMPOSITE_MEMBER_DISABLED | VERSION_CHANGED
```

⚠ `ADMISSION_TESTS_INCOMPLETE` 的 detail **必须指出卡在哪一项**。

### `listModelReferences` —— 停用前的引用枚举（**无清单不得停用**）

```
in:  { modelId }
out: { agents[], skills[], blueprintPolicies[], activeProjects[], inFlightCalls: number }
err: NOT_ORG_ADMIN | REQUEST_TIMEOUT
```

四类引用（agent / skill / 蓝本模型策略 / 进行中项目）+ **进行中调用数 N**（D-U5 确认框要显示）。
R9：3 秒内返回或转异步并给进度。引用为空时返回空数组（**真实空态，不造数**）。

### `disableModel` —— UC-20.2 R3 步骤 3–4：停用与级联

```
in:  { modelId, mode: "interrupt"|"drain", reason }        // D-U5 二选一，默认 interrupt
out: { disabled: true, affected: {...}, interruptedCalls: number }
pre: 已看过引用清单并二次确认；组织管理员
err: NOT_ORG_ADMIN | LAST_SELF_HOSTED_MODEL | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE
```

级联（**均为硬约束**）：
- 新的选择：从所有选择器消失（不置灰，直接不出现）；
- 已有引用：转 **`依赖失败`** 态并**停止被载入**，**不静默改配**（I-16）；
- 进行中项目：`interrupt` = 立即中断并返回「该能力已被管理员停用」；`drain` = 跑完当前一轮，新调用即拒；
- **绝不静默换模型。**
- E3：测试结论被改判为「不通过」时**自动走同一套级联**（等同停用），退出动作留痕。

### `listSelectableModels` —— **可选范围过滤器（唯一实现，三处复用）**

```
in:  { consumer: "agent"|"skill"|"blueprint-policy", purpose?: "onsite"|"post"|"confidential" }
out: ModelCandidate[]     // 每条带 kind 徽标（闭源/自托管）与 complianceAttrs
err: ROLE_INSUFFICIENT
```

⚠ 候选集 = `已启用` 集合（I-2，**口径② 待裁决**）。
⚠ **过滤在服务端**，前端不得自行放宽；即使前端被篡改也选不到未启用模型。
⚠ `purpose = confidential` 时再收窄到 `self-hosted`（与 `routeModelCall` 同一判据）。
⚠ 候选为空时返回 `[]` → 前端显示**真实空态**（大意「请管理员先启用模型」，
文案待定、**非原型原文**），**不预置默认值**。

### `routeModelCall` —— **机密硬路由的唯一执行点**（UC-20.3，本束安全内核）

```
in:  { callId, contextPackId, requestedModelId?, taskKind }
out: { selectedModelId, decisionId, degradedTo?: ModelId }
pre: 上下文装配已完成（Context Pack 已交付）——这是唯一能覆盖全部路径的执行点
err: NO_LOCAL_MODEL_AVAILABLE | CONFIDENTIAL_ROUTE_VIOLATION | MODEL_NOT_SELECTABLE
   | COMPOSITE_MEMBER_DISABLED | MODEL_DEPENDENCY_FAILED | PROVENANCE_WRITE_FAILED
```

判定顺序（**顺序本身是契约**）：
1. 逐项判定机密性——读 Context Pack 各 item 所属 `artifactVersionId` 的机密标记，
   **不得自行另查一套库**（I-13 / X-7）；标记缺失或冲突 ⇒ **从严按含机密**（I-12）。
2. 含机密 ⇒ 候选集 = `已启用 ∩ self-hosted`；**整轮闭源不可用**（I-10，⚠ **口径① 待裁决**）。
3. 不含机密 ⇒ 候选集 = `已启用`。
4. 无可用自托管 ⇒ **明确失败**（`NO_LOCAL_MODEL_AVAILABLE`），**绝不回落闭源、
   绝不静默丢弃机密内容后继续**（I-11）。
5. 含机密 ⇒ **禁止降级**（即使阈值已触发），超限走请人批准或明确失败。
6. 写 `RoutingDecision` 进 `provenance_events`（含拒绝），**记录不含机密原文**（I-13）。
7. 任何绕过尝试（直接指定闭源 / 篡改标记 / API 直调）⇒ 拒绝 + **越权拦截计数 +1**。

⚠ **两道防线缺一不可**：① 服务端硬路由（本用例）② 系统提示注入 `# 硬约束` 段
（`assembleSystemPrompt`）。提示可被模型忽略，**不能只有 ②**。
⚠ E3：自托管模型中途不可达 ⇒ 本次失败并保留输入，**不切换到闭源模型重试**。
⚠ E5：标记在调用发起后变更 ⇒ 以**发起时**判定为准并留痕；已完成的调用不追溯。
⚠ R5：**无角色豁免**——组织管理员亦不能为某次调用开绿灯。
⚠ R9：判定同步完成，时延**百毫秒级**；结果可在同一次调用内缓存，**不得跨调用缓存**。

### `assembleSystemPrompt` —— 提示层硬约束注入（第二道防线）

```
in:  { callId, contextPackId }
out: { prompt, sections: ["# 角色","# 客户与项目上下文","# 方法","# 证据","# 硬约束"] }
err: DEPENDENCY_UNAVAILABLE
```

`# 硬约束` 段**必须逐字包含**「客户机密材料只能由本地模型处理」，
且可在「AI 读到了什么」中被**只读审查**（14-brain 宿主，跨束）。

### `queryRoutingDecisions` —— 路由决策检索

```
in:  { projectId?, actorId?, since?, until?, outcome? }
out: RoutingDecision[]
err: ROLE_INSUFFICIENT
```

⚠ 落 `provenance_events`，与 UC-4.4 / 17-gov **共用同一份数据**（X-4），不另建查询面。

---

# 用例 · B 组 · MCP（F52–F54）

### `registerMcpServer` —— UC-21.1 R3 步骤 1

```
in:  { name, description, endpoint, credential, involvesCustomerData, isEgress }
out: { serverId, reviewStatus: "待安全评审", connectionStatus: "已隔离" }
pre: 组织管理员；端点可达
err: NOT_ORG_ADMIN | MCP_SERVER_UNREACHABLE | DEPENDENCY_UNAVAILABLE | REQUEST_TIMEOUT
```

⚠ `description` **必填**——它承载「这台服务器是干什么的、可不可信」的判断依据
（「第三方·未审计」正是隔离的理由）。
⚠ E1：端点不可达或凭据无效 ⇒ **注册失败，不落半截记录**。
⚠ 开关一为开时初始态恒为「待安全评审 ∧ 已隔离」（I-18）。

### `discoverMcpTools` —— 工具发现 / 重新发现

```
in:  { serverId }
out: { tools: McpTool[], added[], removed[], signatureChanged[] }
err: NOT_ORG_ADMIN | MCP_SERVER_UNREACHABLE | REQUEST_TIMEOUT
```

⚠ **新增工具默认不进任何已有白名单**（I-21，避免权限静默扩大）。
⚠ 删除的工具在引用它的 agent 上标为「工具已不存在」。
⚠ 签名变更 ⇒ 引用条目转 `签名已变更需重新确认`，**确认前不可用**（I-22）。
⚠ 工具全名恒为 `mcp:<服务器>.<工具>`（I-20）。R9：10 秒内返回或明确超时。

### `setAuthScope` —— 三层权限第 ① 层

```
in:  { serverId, authScope: "仅项目负责人"|"仅某团队"|"全体成员", teamId? }
out: { serverId, authScope, affected: { agents[], activeTasks[] } }
pre: 组织管理员
err: NOT_ORG_ADMIN | VERSION_CHANGED
```

⚠ 变更前**列出受影响的 agent 与进行中任务**；**收紧立即生效（含进行中任务）**；放宽亦留痕。

### `reviewMcpServer` —— UC-21.2 放行评审

```
in:  { serverId, verdict: "放行"|"维持隔离"|"有条件放行",
       reason, authScope?, grantedToolIds? }
out: ReviewRecord
pre: 调用者是**安全评审人** ∧ ≠ 注册人
err: WRONG_REVIEW_FUNCTION | SELF_REVIEW_FORBIDDEN | REVIEW_REASON_REQUIRED
   | SCOPE_REQUIRED_ON_RELEASE | AUDIT_IMMUTABLE
```

⚠ `放行` **必须同时设定 `authScope`**（I-25，不允许「已连接但范围未定」）。
⚠ 结论**必填理由且不可删除**。
⚠ **已放行 ≠ 自动进白名单**——仍需能力维护者显式添加。
⚠ `有条件放行`（工具级粒度）**[待定]**，见 `domain.md` ⑧。
⚠ A1：可**退回补充材料**（供应商审计报告等），退回理由留痕。

### `reIsolateMcpServer` —— 重新隔离

```
in:  { serverId, mode: "interrupt"|"drain", reason }
out: { affected: {...}, interruptedCalls: number }
err: NOT_ORG_ADMIN | REVIEW_REASON_REQUIRED
```

立即生效；进行中的调用被终止并**明确失败**（不静默）。

### `getSecurityPolicy` / `setSecurityPolicy` —— 四开关

```
in:  { switchNo: 1|2|3|4, enabled: boolean, confirmToken? }
out: SecurityPolicy
pre: 组织管理员；开关 1/2 需**二次确认**（`confirmToken`）
err: NOT_ORG_ADMIN | POLICY_SWITCH_LOCKED
```

⚠ O-19：开关 3 **任何路径都不可关**；开关 4 **phase-1 无打开入口，直调 API 亦被拒**。
⚠ 开关必须是**真控制而非展示**——每条都要有服务端执行点与可验证的拒绝行为。
⚠ 界面文案随「留痕保留期」参数**动态渲染**，**不得写死「180 天」**（I-24）。
⚠ R9：策略服务不可用时按**最严**处理（视为全部隔离、全部需留痕），**不放行**。

### `authorizeToolCall` —— **三层权限求交的服务端判定点**（本束权限内核）

```
in:  { agentId, agentVersion, toolFullName, taskId?, actorId }
out: { allowed: true, grantingLayers: ["mcp-scope","whitelist","task-package"] }
err: AUTH_SCOPE_DENIED | MCP_SERVER_ISOLATED | MCP_SERVER_UNREACHABLE | MCP_RATE_LIMITED
   | TOOL_SIGNATURE_CHANGED | EFFECTIVE_PERMISSION_DENIED | TASK_PERMISSION_MISSING
   | AGENT_CANNOT_DISCOVER_MCP | PERMISSION_REVOKED_MIDWAY
```

⚠ `有效权限 = ① ∩ ② ∩ ③`，任一层收紧即生效，**下层不得放宽上层**（I-27 / O-23）。
⚠ 拒绝时**必须可解释是哪一层**（`EFFECTIVE_PERMISSION_DENIED.detail.layer`）。
⚠ **被调 agent 独立求交，不继承主调方**（I-47）。
⚠ 拒绝一律计入**越权拦截计数**并进后台数据总览。

### `requestTaskPermissionGrant` —— 第 ③ 层的申请接口

```
in:  { taskId, toolFullName, requestedByAgentId, reason }
out: { requestId, state: "pending-human" }
err: TASK_PERMISSION_MISSING | ROLE_INSUFFICIENT
```

⚠ **授权动作由人在任务侧完成（`[去授权]`），agent 不能自行加。**
⚠ 权限包的**实现**属 00-core / 11-board（X-1），本束只暴露申请接口。

### `listMcpServers` / `listMcpTools`

```
in:  { filter?: { connectionStatus?, authScope?, reviewStatus? } }
out: McpServerRow[] / McpTool[]
err: ROLE_INSUFFICIENT
```

⚠ 非管理员的返回体**不含端点与凭据**（I-6）；端点列对非管理员只显示「内网/外网」粗粒度提示。
⚠ 三字段各自独立返回，**不因界面合并展示而丢失任一维度**（I-17）。
⚠ 清单为空 ⇒ 真实空态，**不预置示例服务器**。
⚠ 工具调用量区块 phase-1 留空或「—」，**不得造数**（D-07）。

---

# 用例 · C 组 · Agent（F55–F60）

### `createAgent` / `cloneAgent` —— UC-4.1 R3 步骤 1 / A1

```
in:  { name, initials, role, visibility, cloneFrom?: AgentId }
out: { agentId, publishState: "草稿", toolWhitelist: [] }
pre: 调用者是能力维护者
err: ROLE_INSUFFICIENT | AGENT_NOT_FOUND | AGENT_MARKET_NOT_AVAILABLE
```

⚠ **复制不继承权限**（I-30 / O-22①）：工具白名单**恒为空**，必须重新配；
记录 `cloneFrom` 来源；因白名单为空而处于 `TOOL_WHITELIST_EMPTY` 硬闸门下。
⚠ 社区导入 phase-1 **不实现**——只保留 `source=community` 取值，入口置灰标 later。

### `updateAgentDefinition` —— 身份 / 行为 / 可见性 / 并发 / 降级

```
in:  { agentId, patch: { role?, visibility?, proactiveSpeaking?, requiresApproval?,
                          modelId?, concurrencyLimit?, degradePolicy? }, expectedVersion }
out: Agent
err: ROLE_INSUFFICIENT | VERSION_CHANGED | MODEL_NOT_SELECTABLE | MODEL_ID_MUST_BE_SINGLE
   | COMPOSITE_MEMBER_DISABLED | AGENT_NOT_FOUND
```

⚠ `modelId` **恒为单个**（I-3）；候选来自 `listSelectableModels`（I-2）。
⚠ E7：并发修改**不得静默覆盖** ⇒ `VERSION_CHANGED`，允许刷新 / 对比 / 重提。
⚠ E5：并发配置超过组织/团队配额上限时提交被拒并**给出可用上限**。

### `mountSkill` —— skill 挂载（**必须到版本粒度**）

```
in:  { agentId, skillId, skillVersion }
out: { mounts: SkillMount[] }
pre: skill 处于 `已启用` 且可见性范围覆盖本 agent
err: ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE | VERSION_CHANGED
```

### `setToolWhitelist` —— 三层权限第 ②（本束权限内核）

```
in:  { agentId, entries: { toolFullName, requested: true }[] }
out: { entries: ToolWhitelistEntry[], elevationRequests: number }
err: ROLE_INSUFFICIENT | MCP_SERVER_ISOLATED | TOOL_SIGNATURE_CHANGED | AGENT_NOT_FOUND
```

⚠ 候选池 = `已连接`（或 `限流中`）∩ 授权范围覆盖该 agent 使用者的服务器的工具。
⚠ **超出授权范围的条目不被静默丢弃，也不被静默批准**——保留为 **`越权申请待确认`**，
由**安全评审人 + 组织管理员会签**逐条裁决。
⚠ 粒度到**工具**而非服务器。
⚠ 读原始转写、读客户资料**要单独授权**——即使在白名单里，仍需第 ③ 层批准。

### `explainEffectivePermission` —— 「为什么被拒」可解释

```
in:  { agentId, toolFullName, actorId, taskId? }
out: { layer1: {...}, layer2: {...}, layer3: {...}, effective: string[], deniedBy?: 1|2|3 }
err: AGENT_NOT_FOUND | ROLE_INSUFFICIENT
```

⚠ 这是 I-27 的**可观测面**：三层各自的结果与最终交集都必须能读出来，否则「服务端可解释」是空话。

### `submitForReview` —— UC-4.1 R3 步骤 9：提交发布

```
in:  { agentId }
out: { publishState: "待审核", securityScan: {...}, elevationRequests: number }
pre: 工具白名单非空
err: TOOL_WHITELIST_EMPTY | ROLE_INSUFFICIENT | MODEL_NOT_SELECTABLE
```

⚠ `TOOL_WHITELIST_EMPTY` 的界面文案逐字为「**还没配工具白名单，不能发布**」（[原型]）。
⚠ 服务端在提交时即阻断；**直接调接口置为 `运行中` 亦被拒并记审计**（I-28）。

### `decideElevationRequest` —— 越权申请逐条裁决（O-21 会签）

```
in:  { agentId, toolFullName, verdict: "准"|"否", reason, signature: {role, actorId} }
out: ElevationDecision      // 需 securityReviewerSig 与 orgAdminSig 两条
pre: 调用者是**安全评审人**或**组织管理员**；≠ 提交人
err: WRONG_REVIEW_FUNCTION | SELF_REVIEW_FORBIDDEN | COUNTERSIGN_MISSING | REVIEW_REASON_REQUIRED
```

⚠ **方法论审核人尝试裁决越权申请 ⇒ `WRONG_REVIEW_FUNCTION`。**
⚠ 只有一条签名时该白名单条目**不生效**，审计视图标为**流程不合规**（I-29 / V22）。
⚠ 理由是：越权申请实际在**扩大 MCP 授权范围（第 ① 层）**，所以要管理员会签。

### `approvePublish` / `rejectPublish` —— UC-4.1 R3 步骤 10

```
in:  { agentId, decision: "批准发布"|"退回", reason? }
out: { publishState: "运行中"|"草稿", agentVersionId }
pre: 安全扫描通过 ∧ 方法论审核通过 ∧ 全部越权申请已裁决完毕；调用者是**方法论审核人** ∧ ≠ 提交人
err: WRONG_REVIEW_FUNCTION | SELF_REVIEW_FORBIDDEN | SECURITY_SCAN_PENDING
   | METHODOLOGY_REVIEW_PENDING | ELEVATION_UNDECIDED | TOOL_WHITELIST_EMPTY
```

⚠ **安全评审人尝试 `[批准发布]` ⇒ `WRONG_REVIEW_FUNCTION`**（两职能不合并）。
⚠ 批准即生成**不可变 `AgentVersion` 快照**（I-31 / O-22⑤）。

### `trialRun` —— UC-4.1 R3 步骤 8：`[试跑]`

```
in:  { agentId, scenario }
out: { steps[], toolCalls[], dataRead[], durationMs, tokens }
err: ROLE_INSUFFICIENT | AGENT_DEPENDENCY_FAILED | REQUEST_TIMEOUT
```

⚠ 试跑**不写入正式记录**，产生的调用**单独标记为 `试跑`**、不计入项目审计的正式事件流，
**但仍需留痕**（A5）。
⚠ 试跑 ≠ 私聊：两者的上下文、留痕与转出能力都不同，**不得复用同一实现而混淆审计归属**。
⚠ R9：超过 10 秒转异步并保留结果。

### `disableAgent` —— O-22④

```
in:  { agentId, mode: "interrupt"|"drain", reason }
out: { publishState: "已停用", interruptedTasks: number }
err: ROLE_INSUFFICIENT | REVIEW_REASON_REQUIRED
```

⚠ 停用后不再被载入、不出现在编排与私聊入口；**已锁版本的在跑项目不受影响**（I-32）。

### `lockAgentVersionForProject` —— D-30：项目开工锁版本

```
in:  { projectId, agentIds[] }
out: { locks: { agentId, agentVersionId }[] }
err: AGENT_NOT_FOUND | AGENT_DISABLED
```

⚠ 运行期内不因 agent 被改动而漂移（I-31）；审计中可读出该版本号。

### `listAgents` —— Agent 库

```
in:  { filter?: { tag?, publishState?, visibility? } }
out: AgentRow[]   // 缩写 | 名字 | 职责·可见性 | 状态徽标 | 模型 | N skills | 调用次数/月 | 操作
err: ROLE_INSUFFICIENT
```

⚠ 可见性范围外的 agent **不出现，且接口不返回其存在性**（I-52）。
⚠ 库为空 ⇒ 真实空态 + `[＋ 新建 Agent]`，**不生成示例 agent**。
⚠ 「调用次数/月」phase-1 留空或「—」（D-07），**不得为了填满界面而造数**。

### `evaluateLoadRules` —— UC-4.2 阶段三：状态事件 → 载入求值

```
in:  { threadId, event: "agenda_segment.switched"|"agenda_segment.state_changed"|...,
       agendaSegmentId, idempotencyKey }
out: { roster: AgentPresence[], loadedBecause: {agentId, triggerEvent, matchedRuleId}[],
       prunedByPriority: {agentId, ruleId}[], nextSegmentPreview?: AgentId[] }
err: AGENT_DEPENDENCY_FAILED | DEPENDENCY_UNAVAILABLE
```

⚠ **幂等**（I-35）：同一事件重复投递不重复载入、计数不翻倍。
⚠ 命中多条时**取前 4 个**，被裁剪的进 `prunedByPriority` **可查**（I-37，不得静默丢弃）。
⚠ 触发条件**只能引用 `agenda_segment_id`**（I-36 / D-03a）。
⚠ E2：规则引用的 agent 已不在 `运行中` ⇒ **跳过并明确提示**，**不静默降级为别的 agent**。
⚠ E3：可见性范围不覆盖当前项目/团队 ⇒ 不得载入（Ledger「仅能源组」不能被平台组项目载入）。
⚠ E4：`跑批中` 的 agent 在议程环节切换时**不被强制换出**——后台任务跑完仍要回到本线程。
⚠ R9：状态事件到团队切换对参与者可见应在 **1 秒内**。

### `getThreadAiTeam` —— 线程级 AI 团队投影

```
in:  { threadId }
out: { roster[], rosterCount, presentCount, stale?: { lastUpdatedAt } }
err: ROLE_INSUFFICIENT
```

⚠ **`rosterCount` 与 `presentCount` 是两个字段，接口不得混用同一个键**（I-34）。
⚠ E8：实时通道不可用 ⇒ 降级为轮询并返回 `stale`，前端**必须显示「非实时」与最后更新时间**，
**不得让引导师以为团队已切换**。
⚠ 线程无任何 agent ⇒ 真实空态 + 加入入口，**不自动塞默认 agent**。

### `composeThreadTeam` —— `[编制]` / 加入 / 静音 / 复位

```
in:  { threadId, add?: AgentId[], remove?: AgentId[], muteAllProactive?: boolean, reset?: boolean }
out: ThreadAiTeam
pre: 调用者是引导师或协同引导师（O-03：协同引导师 = 引导师的多实例）
err: ROLE_INSUFFICIENT | AGENT_NOT_FOUND | AGENT_DISABLED | AGENT_MARKET_NOT_AVAILABLE
```

⚠ 手工编制**覆盖**本轮规则求值结果，直到下一次状态变化或引导师复位。
⚠ **冲突优先级与失效时机 [待定]**（`domain.md` ⑫）。

### `getProjectAiPermissions` / `setProjectAiPermissions` —— 项目级三开关

```
in:  { projectId, patch: { facilitatorProposesConvergence?, liveTranscription?, aiWritesOnCanvas? } }
out: { permissions, effective: {...} }   // effective = 三粒度求交结果
pre: 引导师；⚠ 协同引导师变更须由**主持人确认**（它改变全场 AI 行为边界）
err: ROLE_INSUFFICIENT | VERSION_CHANGED
```

⚠ **默认全关**（I-38 / O-23）；`有效值 = 组织/agent ∩ 项目 ∩ 画布/线程`，**下层只能更严**。
⚠ **服务端求交**，不得由任一层自行决定最终值。
⚠ 变更须留痕且**对项目成员可见**（谁在何时关了什么）。
⚠ A5：某项被关闭时，依赖它的 agent/skill 在编制列表里标为「本场已关闭」并说明去哪里开，
**不静默不工作**。

### `suggestRedispatch` / `applyRedispatch` —— 改派路由

```
in:  { threadId, messageId }                       // suggest
out: { suggestedAgentId, reasonAuthorityName }     // 如「行业数据库授权」
in:  { threadId, messageId, accept: boolean }      // apply
err: ROLE_INSUFFICIENT | AGENT_NOT_FOUND
```

⚠ 判据是**三层权限求交后的授权集**比对（不是模糊匹配）。
⚠ **改派是建议，必须人点 `[改派]`**；`[×]` 可忽略。
⚠ 理由**必须写出具体授权名**，不得只说「更合适」。
⚠ R9：建议的生成**不得泄露当前用户无权知晓的授权信息**——只说「它有行业数据库授权」，
不列出具体工具与凭据。
⚠ 行业数据库 MCP 置为已隔离后，该建议**不再出现**。
⚠ **组员是否能看到改派提示 [待定]**。

### `openPrivateChat` / `postPrivateMessage` —— UC-4.3

```
in:  { threadId, agentId }  →  { chatId, agentVersion, skillMounts[], presence, modelId,
                                 degradedBadge?, auditNotice: "本对话属于本项目，可被审计" }
in:  { chatId, text }       →  { messageId, toolCalls[] }
pre: agent 处于 `运行中` ∧ 可见性范围覆盖当前用户；组员需引导师**逐场**开启
err: AGENT_NOT_FOUND | PRIVATE_CHAT_DISABLED | ROLE_INSUFFICIENT
   | AGENT_DEPENDENCY_FAILED | EFFECTIVE_PERMISSION_DENIED | NO_LOCAL_MODEL_AVAILABLE
```

⚠ **私聊不构成提权**（I-40）：三层权限 + 项目级 AI 权限同样生效；高风险动作照样弹批准卡。
⚠ **对话不进主线程**（I-39）：不进消息流、转录、洞察、产物，也不计入线程消息数与在场编制。
⚠ **归项目层**（O-24），入口/面板**必须明示**「本对话属于本项目，可被审计」（I-41 的义务侧）。
⚠ E1：agent 在私聊中被换出编制 ⇒ **私聊不中断**，但提示「它已不在本线程在场名单里」。
⚠ E2：依赖失败 ⇒ **明确失败或明确降级并标注**，**不静默换模型、不静默跳过工具调用**。
⚠ A2：与 `跑批中` agent 私聊时给出提示与 `[看任务队列]`。
⚠ 观察者**无私聊入口且接口拒绝**。

### `transferConclusionToThread` —— 转出结论到主线程

```
in:  { chatId, messageId, targetThreadId }
out: { threadMessageId, provenance: { agentId, agentVersion, skillId, skillVersion, at, dataSources[] } }
err: TRANSFER_TARGET_READONLY | TRANSFER_PROVENANCE_INCOMPLETE | ROLE_INSUFFICIENT
```

⚠ 转出内容在主线程中仍标识为**机器产出**，并可点回私聊原文（受权限约束）。
⚠ **转出后是否允许撤回 [待定]**。

### `setMemberPrivateChatSwitch` —— 组员私聊逐场开关（O-24）

```
in:  { projectId, enabled: boolean }
out: { enabled, scope: "this-session-only" }
pre: 引导师
err: ROLE_INSUFFICIENT
```

⚠ **逐场生效，不跨场继承。**

### `recordToolCall` —— UC-4.4 阶段一：**tool-call 四要素写入**

```
in:  { callId, signature, params, hitCount, runState, durationMs, tokens,
       callerAgentId, agentVersion, skillVersion, modelId, permissionSnapshot,
       grantingLayer, messageId, threadId, projectId }
out: { recordId }
err: PROVENANCE_WRITE_FAILED
```

⚠ **硬前置：写入失败 ⇒ 该次工具调用必须失败**（I-44）。
**不允许「调用成功但没留痕」**——审计是硬前置，不是旁路。
⚠ 内建（`graph.` / `brain.`）与 MCP（`mcp:<服务器>.<工具>`）命名空间**必须可区分**（I-20）。
⚠ `runState` **逐条独立**，不是整体一个状态。
⚠ 落 `provenance_events`（**append-only**，I-45）；写入属**持久任务系统**侧（不可丢、可重放），
**不得挂在 LangGraph 图上**。
⚠ **缺 `agentVersion` / `skillVersion` / `modelId` / `permissionSnapshot` 任一项即审计不完整**（I-48）——
校验拒绝写入，而非静默补空。

### `getMessageToolSummary` —— 消息级摘要

```
in:  { messageId }
out: { thinkSeconds, steps, toolCallCount, readItems, tokens, calls: ToolCallRecord[] }
err: ROLE_INSUFFICIENT
```

对应 [原型] `▸ 思考了 8.2 秒 · 4 步` / `工具调用 · 3 ｜ 读了 64 条 · 12.4k token`。
⚠ R9：tool-call 记录数比审计条目**高一到两个数量级**，必须分页/增量加载，
**禁止一次加载整个项目历史**。

### `recordCallChainHop` —— agent 互调

```
in:  { callerAgentId, calleeAgentId, taskName, depth, tokens }
out: { chainId, approvalState: "已暂停"|"人已批准"|"已拒绝"|"已取消" }
err: CALL_DEPTH_EXCEEDED | EFFECTIVE_PERMISSION_DENIED | AGENT_DISABLED | PROVENANCE_WRITE_FAILED
```

⚠ **深度上限 2**（O-36）；深度 3 **在第 3 层被终止**并留痕（I-46）。
⚠ **被调方不继承主调方权限**——独立按三层权限求交（I-47）。
⚠ E4：被调 agent 已不在 `运行中` 或权限不覆盖本次请求 ⇒ 调用被拒并留痕，
主调方**明确失败，不静默换 agent**。
⚠ 未获批准即终止的调用链**同样留痕**（`已拒绝` / `已取消`）。

### `decideApproval` —— 批准卡三个出口

```
in:  { chainId, action: "批准执行"|"改参数再跑"|"不用了", patch?: { modelId?, tokenBudget? } }
out: { state, backgroundTaskId? }
err: CONFIDENTIAL_ROUTE_VIOLATION | NO_LOCAL_MODEL_AVAILABLE | ROLE_INSUFFICIENT | VERSION_CHANGED
```

⚠ **`[改]` 面板在含机密时只列自托管候选**；提交闭源模型 ⇒ `CONFIDENTIAL_ROUTE_VIOLATION`。
⚠ 批准人**不能改变路由结果**，只能批准或取消（R5）。
⚠ 批准后转后台任务（[原型]「约 6 分钟回到本线程」`[看任务队列]`）。
⚠ 高影响操作的 HITL 用 LangGraph 动态 `interrupt()`，**checkpoint 必须落库，
节点恢复时副作用必须幂等**。

### `queryAuditTimeline` / `exportAudit` —— 项目级审计（**已存在的屏，别搬走**）

```
in:  { projectId, types?: ("角色变更"|"版本"|"Agent 调用"|"决策")[], agentId?,
       elevated?: boolean, approved?: boolean, since?, until?, cursor? }
out: { entries[], counts: {all, roleChange, version, agentCall, decision}, nextCursor }
in:  { projectId, format: "csv"|"json" }  →  { downloadUrl } | { asyncTaskId }
err: ROLE_INSUFFICIENT | EXPORT_TOO_LARGE | AUDIT_IMMUTABLE
```

⚠ **四类事件同一条时间线，不可删除**（I-51）。任何删除/修改请求一律被拒并记安全审计。
⚠ 导出内容**与界面一致、可复现**；大批量转异步并给回执。
⚠ 无数据 ⇒ 真实空态与原因，**不生成示例条目**。

### `drillDownAuditEntry` —— 审计条目下钻

```
in:  { entryId }
out: { input, contextPackId, injectedSkills: {skillId, skillVersion}[],
       toolCalls[], callChain, approvals[], adopted[], ignored[] }
err: ROLE_INSUFFICIENT | AGENT_NOT_FOUND
```

⚠ A3：**参数含敏感值时默认脱敏展示**，有权者展开原值，**展开动作本身留痕**（D-16）。
⚠ A4：私聊中的工具调用同样进本时间线，但审计**只暴露调用元数据，不暴露私聊正文**。
⚠ **「被采纳 / 被忽略」的判定方式 [待定]**——建议按 O-35 用**结构性断言**
（「是否被转成待办卡或写入产出」＝ 被采纳），避免不可复现的推断。

### `queryOrgAudit` —— 组织级跨项目检索（D-34，**屏尚未建**）

```
in:  { projectId?, actorId?, since?, until?, cursor? }
out: { entries[], nextCursor }
pre: 组织管理员
err: NOT_ORG_ADMIN | EXPORT_TOO_LARGE
```

⚠ **D-18：管理员读项目内容须写审计日志且对项目负责人可见**——
管理员的**每次审计访问本身也是审计事件**。
⚠ 个人层只见计数（管理员权力边界在本束不放宽）。

### `listAnomalies` / `markAnomalyNormal` —— 异常检测与自动限速

```
in:  { severity?: "高"|"中", handled?: boolean }  →  Anomaly[]
in:  { anomalyId, reason }                       →  { rateLimitReleased: true }
pre: 组织管理员
err: NOT_ORG_ADMIN | REVIEW_REASON_REQUIRED
```

⚠ **额度异常判据 = 24 小时滚动窗口均值的 10 倍**（O-36），**不是绝对阈值**；
命中即**自动限速**（系统动作，**不等人**）。
⚠ **越权调用必须拦截并计数**，不是仅记录。
⚠ 限速与拦截**本身是审计事件，且对当事人可见**（被审计对象本人应能看到针对自己的告警与理由）。
⚠ `[标记为正常]` 须**填理由**，解除限速，观察期内同类行为不再重复告警。
⚠ R9：异常检测为**准实时（分钟级）**，限速须在检测后**立即生效**。
⚠ D-07 边界：**异常检测所需实时用量判据保留**，面向展示的统计报表不做。

### `replayAgentRun` —— 架构 P4：agent run 四件套可重放

```
in:  { runId }
out: { plan, steps[], checkpoints[], contextPack: { items[], anchors[],
        retrievalReasons[], omissions[], permissionDecisionId } }
err: AGENT_NOT_FOUND | DEPENDENCY_UNAVAILABLE
```

⚠ AC1「**当时的输入**」就是那次 run 的 Context Pack，**必须可重放**（I-49，跨 phase-00）。
⚠ Context Pack 的 `retrievalReasons` / `omissions` / `permissionDecisionId` 使
「为什么读到这条」「少读了什么」「凭什么能看」三问可回答。

---

## 端口（`infrastructure` 实现这些）

| 端口 | 职责 | 实现 |
|---|---|---|
| `ModelRegistry` | 模型池、组合记录、状态、合规属性 | PostgreSQL（RLS 强制） |
| `CredentialVault` | 凭据加密存储、**永不回显**（I-6） | KMS / 密文列 + 只写接口 |
| `ModelProviderGateway` | 实际模型调用；**可替换 provider 抽象，不绑定厂商**（O-40） | AI gateway |
| `AdmissionTestLog` | 五项判读 **append-only**（I-7） | PostgreSQL |
| `McpRegistry` | 服务器/工具、三正交字段（I-17） | PostgreSQL |
| `McpConnector` | 工具发现、调用、连接状态监测（分钟级） | MCP client |
| `SecurityPolicyStore` | 四开关；开关 3/4 **写入受锁**（I-14） | PostgreSQL + 常量约束 |
| `AgentRepository` | agent 定义、版本快照（I-31）、白名单 | PostgreSQL |
| `PermissionEvaluator` | **三层求交唯一实现**（I-27）+ 可解释 | 纯函数 + 仓储 |
| `LoadRuleEngine` | 规则求值，**幂等**（I-35）、优先级裁剪 | **持久任务系统（PG outbox + worker）** |
| `TaskQueue` | 并发排队（I-33）、后台任务、`[看任务队列]` | PG outbox + worker |
| `ProvenanceWriter` | **append-only**（I-45）；写入失败即调用失败（I-44） | PostgreSQL（表层面拒 UPDATE/DELETE） |
| `AnomalyDetector` | 24h 滚动窗口均值 10 倍、自动限速 | 准实时流 + worker |
| `ContextApi` | 取 Context Pack；**唯一取数入口**（I-50） | phase-00 `context-pack` 束 |
| `RetentionParams` | 「留痕保留期」/「审计保留期」参数（I-24） | 17-gov 配置，**本束只读** |

⚠ **编排边界（架构第六节，三份 UC 反复强调）**：
**LangGraph 只用于深度研究、人工确认（HITL）、多阶段生成**；
**摄取流水线与规则求值、并发排队、审计写入用持久任务系统**（PG outbox + worker）。
**两者不可混用。** 批准卡的 HITL 中断属 LangGraph 侧，审计写入属任务系统侧。

⚠ `ProvenanceWriter` 的「append-only」**不能只是应用层不去改**——I-45 要求
**表层面**拒绝 UPDATE/DELETE（触发器/权限），否则「审计不可篡改」只是一句约定。
