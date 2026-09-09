# 管理与运行读取复用表

独立只读审查基线154a541d61e29f881d2517516759059a331f6c14；相对733f9d9ed相关生产读取文件未变化。下表表示代码/契约落点，未执行这些接口的线上动态验收。

| 用户要看的信息 | 应复用的既有入口 | 最小增量与边界 |
|---|---|---|
| 模型列表/当前详情 | agentRuntime.listModelPool，GET /models；ModelController.list，web/lib/live-model.ts | 采用capability-admin-deltas的configRevision与single映射。不要另建getModel详情API |
| 模型准入历史 | AdmissionTestRepository.listForModel，PG已有seq ASC历史；暂无HTTP读 | 新GET /models/:modelId/admission-tests；复用AdmissionTestRecord，增加seq/configRevision，仍org-admin |
| MCP首次连接 | discoverRemoteMcpTools，POST /mcp-servers/discover-remote；application/mcp/discover-remote-server.ts | 发现成功后已有保守治理行upsert；不再造首次连接操作。未接线registerMcpServer的完整治理语义不得冒称已经实现 |
| MCP当前详情/凭据是否存在 | listMcpServers，GET /mcp-servers；详情抽屉读列表行 | 已有credentialConfigured，仓储不读取密文。沿用列表扩configRevision；精确endpoint输出须明确签核，不能从DB存在字段推导可回显 |
| MCP首次连接审计 | mcp_servers已有registered_by_actor_id/first_discovered_at | 如需展示，在现有listMcpServers投影registeredByActorId/firstDiscoveredAt；无新详情接口 |
| 发布版本Skill试跑 | skills.getTrialRun，GET /skill-trial-runs/:trialRunId；skill-trial-run.controller.ts | 已有actor-scoped读取，跨组织/非提交者404。成功input/output/artifacts已有；失败trialRun=null丢失versionId/sampleInput，需顶层增加不可变versionId/input |
| Skill试跑错误诊断 | getTrialRun.failure.stderr/attempts | 复用最后真实stderr和执行次数；不凭空承诺完整逐attempt日志持久化 |
| Skill试跑产物字节 | getTrialRun.trialRun.artifacts仅元数据name/mime/sizeBytes/objectKey | 需要trial-scoped且actor-scoped的下载授权/流入口，浏览器不能直接消费objectKey；不能借用项目artifact版本下载API |
| 后台Agent试跑 | agentRuntime.trialRunAgent，同步POST /agents/:agentId/trial-run | steps/toolCalls/dataRead/durationMs/tokens已有，asyncTaskId恒null；没有持久trial ID，不把聊天run或Skill trial接口冒充其历史恢复 |
| 真实聊天run详情 | wave2Runtime.getAgentRun，GET /agent-runs/:runId | run/agent/version/steps已有；只需精确modelConfigRef与mcpSnapshotRef增量，不造第二个run详情API |
| 真实run输入 | getAgentRun.threadId/inputMessageId→chat.listMessages | 复用DurableMessage.text/attachments，不在run复制输入正文；保持原线程可见性 |
| 真实run执行轨迹 | GET /agent-runs/:runId/execution-events；web/lib/chat-workbench/execution-events-api.ts | 复用执行journal。完整transcript单独GET /agent-runs/:runId/transcript且仅admin；摘要不冒充完整args/result |
| 真实run产物 | GET /agent-artifacts/threads/:threadId，web/lib/chat-workbench/agent-artifacts.ts | 按服务端producedByRunId关联版本和认证contentUrl；不在getAgentRun复制产物数组 |
| 真实run失败详情 | errorObservability.getRunFailure已声明GET /agent-runs/:runId/failure，但暂无controller/application | 优先实现已声明操作，再附服务端RuntimeFailureAttributionRefs；不要新造第二个failure操作 |
| 运行时MCP历史快照 | 内部冻结/解析已有，暂无用户可读API | 若配置页需要展开工具，新增受run可见性约束的快照读；目前引用卡只展示ID/digest，不拿当前工具冒充历史 |

## 后续准确验收

C33对应：既有getRunFailure实施+归因、Skill trial失败输入、trial产物下载、必要的run-scoped MCP历史快照。新开发草稿试跑仍需明确自身job到实际运行结果/产物的关联；不能把只支持发布版本的getTrialRun直接接到draftId。

C36对应：Model admission历史GET、MCP现有列表审计字段与CAS增量。MCP保密信息仍只返回credentialConfigured；若需精确端点输出，单列权限与脱敏决策。以上字段复用现有record/enum，不创建第二套Model/MCP状态。

## Model 准入历史读取提案（2026-09-10）

`packages/contracts/src/model-admission-history.ts` 新增只读提案 `listModelAdmissionTests`，复用 AdmissionTestRecord，追加存储序号 seq 与可空 configRevision。旧数据库记录没有配置版本，必须显示“版本未知”，不得补成当前版本，也不能据此允许当前版本启用。

首次请求 afterSeq=0、snapshotSeq=null，服务端在组织及模型范围内获取实际 MAX(seq)，无记录时为0；随后页面固定此上界，按 seq ASC 读取，每页最多100项。新判读可以追加但不混入当前翻页快照，刷新开始新快照。末页 nextAfterSeq=null 且必须抵达上界；空末页仅在 afterSeq 等于上界时成立。adapter 需要多查一项来决定是否还有记录，schema 不证明数据库查询完整性。

授权仍为组织管理员，租户从会话派生，先授权后读仓储。不新增修改/删除历史入口，不回传凭据或端点。五项反证测试覆盖版本未知、重复/串模型记录、翻页上界变化、提前结束和额外敏感字段。此提案未接入 controller、数据库迁移或页面请求，首次 MCP 连接与审计投影仍待补齐，C36仅进行中。
