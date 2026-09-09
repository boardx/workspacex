结论：以下规格仅用于 Model/MCP 后台原型评审，依赖 PR #3239 的设计 delta，现有 controller 尚未完整支持，不能标记为生产接入。全程只复用既有状态，没有新增状态枚举，也未修改工作树。

## Model 页面

### 1. 配置 revision 失效 → 重测 → 启用

| 项目 | 可实现规格 |
|---|---|
| 控件 | 详情抽屉顶部固定显示 `modelId`、`shape`、当前 `configRevision`、现有 `ModelStatus`。`single` 显示 `providerKey`、`upstreamModelId`、endpoint、凭据替换框；`composite` 隐藏顶层 provider/upstream，仅显示有序成员及各成员状态/revision。 |
| 保存动作 | `PATCH /models/:modelId`，提交页面载入时的 `expectedVersion=configRevision`。仅 `single` 可提交 provider/upstream；运行绑定、endpoint 或凭据变化触发重测。 |
| 成功 | 采用响应中的新 `configRevision/status/retestRequired`。`retestRequired:true` 时状态显示既有 `待测试`，清除页面上的“当前版本已通过”展示，从模型选择器移除，并把主操作切换为“开始重测”。不得沿用旧 revision 的准入记录。 |
| 普通失败 | 展示服务端既有 reason code；不乐观更新卡片、revision 或状态。凭据输入立即清空且永不回显。 |
| 陈旧返回 | `VERSION_CHANGED`：保留非敏感表单草稿，禁用“测试/启用”，显示“载入 revision / 当前 revision”，提供“加载最新配置”和“复制修改后重新应用”。不得自动覆盖或自动重试。 |
| 复用状态 | `ModelShape=single｜composite`；`ModelStatus=待测试｜已启用｜已停用｜依赖失败`。不得继续使用页面当前自造的“未启用”。 |

现有契约已定义 `expectedVersion`、`retestRequired` 和 `VERSION_CHANGED`，但尚无真实 `configureModel` 接线；当前页面的启用、停用、判读仍只改 React 本地状态：[契约](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/packages/contracts/src/agent-runtime.ts#L915-L953)、[页面说明](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/apps/web/components/admin/model-screen.tsx#L21-L41)、[本地操作证据](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/apps/web/components/admin/model-screen.tsx#L300-L347)。

### 2. 重测及启用

| 项目 | 可实现规格 |
|---|---|
| 控件 | 抽屉内显示锁定的“正在验证 revision”。一个“运行连通性测试”按钮；五张准入卡分别使用既有五项名称，每张提供 `通过/不通过/不适用` 单选和必填 evidence。 |
| 测试动作 | `probeConnectivity` 增加设计 delta 的 `configRevision`；结果只作为连通性证据，不自动写成人工“通过”。保存判读时，`recordAdmissionTest` 同时提交该 revision。 |
| 测试成功 | 只把响应明确绑定到当前 revision；每项保存 append-only 记录。五项当前有效记录全部为 `通过` 后才启用“启用模型”。 |
| 测试失败 | `credential/unreachable/timeout` 显示在连通性卡；`DEPENDENCY_UNAVAILABLE/REQUEST_TIMEOUT` 显示原 reason code。失败不能降格显示为无解释的“待测试”。 |
| 测试陈旧 | 服务端返回 `VERSION_CHANGED` 或响应绑定 revision 与页面不同：结果标为“已过期，未应用”，刷新当前配置，不写准入记录。 |
| 启用动作 | `POST /models/:modelId/enable`，提交 `expectedVersion=current configRevision`。 |
| 启用成功 | 采用服务端返回的既有状态 `已启用`，再刷新详情和可选模型集。 |
| 启用失败/陈旧 | `ADMISSION_TESTS_INCOMPLETE` 精确高亮缺失项；`COMPOSITE_MEMBER_DISABLED` 展开阻塞成员；`VERSION_CHANGED` 回到配置冲突流程。不得用新状态表达这些错误。 |

五项及三种判读已经是闭集，[契约 L48–58](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/packages/contracts/src/agent-runtime.ts#L48-L58)；当前记录缺少 revision，而启用操作已有 `expectedVersion`，[契约 L603–615](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/packages/contracts/src/agent-runtime.ts#L603-L615)、[L955–1011](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/packages/contracts/src/agent-runtime.ts#L955-L1011)。

### 3. Composite 的原型边界

- 不显示或提交一个虚构的 composite `providerKey/upstreamModelId`。
- 成员列表本轮只读；现有 `configureModel` 没有修改 members 的字段，不能借原型扩出组合编辑能力。
- 显示非持久化提示：“当前执行端口不支持组合模型执行”。这只是能力说明，不是新 `ModelStatus`。
- 即使 composite 行当前为 `已启用`，原型也不得把第一个成员当成实际模型运行。
- 运行/失败归因必须满足：

```ts
actualModelId = degradedTo ?? selectedModelId
modelBinding.capabilityModelId === actualModelId
```

当前 `degradedTo` 的成功路径恒为 `null`，所以现实现实际目标是 `selectedModelId`；若实际目标为 composite，应明确阻断而非压成单 provider。[Composite 核对材料](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/phases/phase-15-ai-capability-studio/design-proposal/capability-studio/composite-model-mapping.md#L63-L94)、[单模型绑定约束](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/packages/contracts/src/capability-runtime-policy.ts#L25-L41)。

## MCP 页面

### 4. Keep / Replace / Clear 重连

| 项目 | 可实现规格 |
|---|---|
| 控件 | 在现有“重新连接/更新端点”区增加“凭据处理”单选：`保留现有凭据 keep`、`替换凭据 replace`、`清除并匿名连接 clear`。endpoint 仍需重填，因为列表只返回 `endpointHint`。 |
| 初始选择 | `credentialConfigured=true` 默认 keep；无旧凭据时 keep 禁用、默认 replace。replace 才显示必填密码框；clear 显示确认提示。 |
| 提交动作 | “重新连接并发现工具”。请求发送 `credentialMutation`，不再用 nullable credential 猜测意图。 |
| 成功 | replace 后 `credentialConfigured=true`；clear 后为 false；keep 保持原值。展示 `added/removed/signatureChanged/tightenedByCapRecheck`。连接状态、评审状态和服务器授权范围只采用刷新接口返回值，发现成功本身不得推导它们。 |
| 失败 | 明确显示“连接失败；原端点、原凭据和工具授权未更改”。不乐观修改列表；replace 输入清空。只有服务端实际返回 `凭据失效` 时才显示该既有连接状态，不能从通用 `MCP_SERVER_UNREACHABLE` 猜测凭据过期。 |
| 陈旧返回 | 当前重连接口没有 `expectedVersion/VERSION_CHANGED`，因此不存在可宣称的服务端并发冲突语义。原型仅用本地 `requestSeq + serverId` 忽略较早返回，并重新拉取详情；多管理员写冲突仍是待签 delta，不能伪装成已解决。 |
| 复用状态 | `McpConnectionStatus`、`McpReviewStatus`、`ToolAuthScope` 三维独立；keep/replace/clear 只是写入意图，不是状态。 |

当前 UI 将空 token 直接映射为 `credential:null`，[页面 L234–269](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/apps/web/components/admin/mcp-screen.tsx#L234-L269)；现契约又把 null 定义为匿名连接，[契约 L1259–1294](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/packages/contracts/src/agent-runtime.ts#L1259-L1294)，无法表达“清除已存凭据”。三种明确意图的草案位于[ runtime policy L77–93](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/packages/contracts/src/capability-runtime-policy.ts#L77-L93)。

### 5. 新工具默认未授权

| 返回分类 | 页面行为 |
|---|---|
| `added[]` | 置顶显示“新增工具”，每行直接采用返回的 `authScope=未开放`；授权控件默认关闭。 |
| `signatureChanged[]` | 显示既有白名单状态“签名已变更需重新确认”，确认前不可运行；不得自动恢复旧授权。 |
| `removed[]` | 显示“工具已不存在”，保留引用提示，不能从 Agent 配置中静默消失。 |
| `tightenedByCapRecheck[]` | 显示原授权范围、收紧后的既有授权范围及副作用原因。 |
| 显式授权 | 管理员逐工具选择既有 `ToolAuthScope`；仍需经过服务器级上限及副作用上限。发现或重连操作本身绝不触发授权，也不提供默认“全部开放”。 |

新工具默认 `未开放` 已有常量和契约约束：[默认值](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/packages/contracts/src/agent-runtime.ts#L182-L183)、[发现结果字段](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/packages/contracts/src/agent-runtime.ts#L659-L701)。

## 运行失败返回配置页

运行错误卡只使用服务端生成的 `RuntimeFailureAttributionRefs`，客户端不得根据错误文案猜模型或 MCP。

| 引用存在 | 控件与导航 | 配置页行为 |
|---|---|---|
| `modelConfigRef` | “查看本次模型配置” → `/admin/model?modelId=<capabilityModelId>&configRevision=<revision>&fromRun=<runId>` | 当前 revision 相同：显示“本运行使用此配置”。不同：并列显示“运行使用 revision / 当前 revision”，不得把旧运行失败归因给当前配置。没有历史配置读取 API 时只显示引用，不伪造旧配置内容。 |
| `mcpSnapshotRef` | “查看本次 MCP 快照” → `/admin/mcp?snapshotId=<snapshotId>&fromRun=<runId>` | 先解析快照并展示其中服务器/工具；当前引用没有单一 `serverId/toolFullName`，因此不能擅自深链某台服务器。快照 digest 与当前发现不同仅显示“运行快照与当前配置不同”的提示，不增加状态。 |
| 两者均为空 | 不显示配置跳转 | 保留既有 run 错误和重试入口。 |
| 页面无权限或引用不可见 | 复用既有拒绝/不存在处理 | 不暴露实体是否存在，更不显示 endpoint、provider/upstream 或凭据。 |

只有服务端明确返回 `mcpSnapshotRef` 才能显示 MCP 跳转；现有 `AgentRunError` 没有 MCP 专用错误码，不能把通用 `MODEL_CALL_FAILED` 自动归为 MCP。归因引用的精确安全边界见[ runtime policy L95–113](https://github.com/boardx/workspacex/blob/6617dceefbb7bb2ca64da68fe89491654d8949df/packages/contracts/src/capability-runtime-policy.ts#L95-L113)。

## PR #3241 新 SHA 复审

静态复审通过，结论针对新 SHA：

- 新 head 是 [`f6ac3bb9b82dd988533a55647c899b1749536199`](https://github.com/boardx/workspacex/commit/f6ac3bb9b82dd988533a55647c899b1749536199)。
- 它是双亲 merge commit：
  - 第一父：已审修复 `0a293c44ac43d76998487cbdf1f4219df1ddb389`
  - 第二父：当时的 `main@41b511066836202b1241152915b99c95c2bb93a9`
- 相对第一父仅带入第二父的 15 个 main 文件；逐文件 blob 与第二父一致。
- 相对 main 只剩 PR 的三个文件；这三个文件的 blob 与 `0a293c44…` 完全一致：
  - 发现实现：`18f8b7ec8d676e61a9258aebce8ae6d714e71f36`
  - 测试：`3b12b31a5e3eb6885aff68ed44aab2806b90480f`
  - 报告：`1645d067aa67f9a24d389247bd819f93c2b432e9`

已审修复仍原样保留：

- `addCandidate` 仍返回 `absent | unavailable | added`。
- 起点仅在 `added` 时提前结束。
- 子目录遇到任何非 `absent` 仍保持既有包边界。[实现 L249–278](https://github.com/boardx/workspacex/blob/f6ac3bb9b82dd988533a55647c899b1749536199/apps/api/src/application/skill-import/discover-skills-from-url.ts#L249-L278)
- “起点不可下载时继续发现子 Skill”反证仍在。[测试 L228–250](https://github.com/boardx/workspacex/blob/f6ac3bb9b82dd988533a55647c899b1749536199/apps/api/tests/skill/discover-skills-from-url.test.ts#L228-L250)

精确表述是“main 被合入 PR 分支”，不是“PR 已合入 main”；当前 `f6ac…` 不是 `origin/main` 的祖先。本轮没有在新 SHA 动态重跑 18/18，因此只确认修复和测试内容未被 merge 改动，不把报告中的历史运行结果冒充本轮重跑证据。未修改文件、未合并 PR。
