# 用例覆盖工作表

提案映射，API 名称在共享 schema 到位后校准。当前所有行均未有实现/验收证据。

| UC / R12 | API 操作提案或现有落点 | UI 消费点 | 待验证 |
|---|---|---|---|
| S01 | CreateImportPreview / ConfirmImport | 来源导入与候选预览 | 来源固定、权限、路径、幂等 |
| S02 | GetImportJob / RetryImportJob / CancelImportJob | 导入任务进度 | 恢复、部分成功、重复提交 |
| S03 | ReadSkillDraft / MutateSkillDraftFile | 文件树与草稿编辑 | CAS、原子变更、保存不发布 |
| S04 | AI patch proposal / RunSkillDraftTrial / GetSkillDraftTrial | 差异确认与测试面板 | 精确快照、证据过期、拒绝执行 |
| S05 | PublishSkillDraft / existing Agent version pin | 发布确认与 Agent 选择 | 权限、revision、一致绑定 |
| S06 | CheckSkillUpstream / MergeSkillUpstream / RollbackSkillVersion | 更新冲突与版本历史 | 三方合并、历史不可变 |
| S07 | existing registerModel/probeConnectivity/enableModel/disableModel | 模型管理 | 持久化、路由映射、停用零出站 |
| S08 | existing MCP review/scope/runtime + connection credential delta | MCP 管理 | 权限交集、重连、撤权 |
| S09 | existing chat/run/artifacts + failure feedback delta | 真实聊天与反馈返回 | 浏览器/API/DB/真实产物联合证据 |

执行层既有状态与错误枚举优先复用。正式 API 增加后逐条证明没有孤儿 UC 或孤儿 API；不可把这张提案表当作已通过的覆盖证明。


## 可执行草案增量（尚未签核）

- `packages/contracts/src/skill-development.ts`：来源请求与服务端解析快照分离；候选列表、批次/单项查询、单项重试/取消；新建批次与覆盖草稿CAS分开；多文件原子保存和文件读取；精确草稿试跑；按服务端run ID发布；上游冲突选择；恢复历史文件为草稿。
- `packages/contracts/src/capability-runtime-policy.ts`：模型池ID与provider/upstream映射、配置版本、试跑依赖快照、凭据keep/clear/replace、运行失败归因引用。Skill草案直接引用依赖快照，不复制一套模型/MCP定义。
- 草案定向验证：14项通过；不代表任务持久化、授权、SSRF、发布事务、重试幂等或真实模型执行已经实现。上述性质必须由后续application/API/数据库测试证明。
- 已有签核契约与生产路由未被这些草案替换。新增草案尚未index导出；正式束形成时需明确导出和OpenAPI/前端消费点。

新增空白草稿与AI差异操作草案：createSkillDraft、proposeSkillDraftPatch、getSkillDraftPatchJob、applySkillDraftPatchProposal。生成与应用分离，结果基线交叉校验，应用仅接收服务端proposal引用及草稿CAS；4项定向测试通过。最新可执行契约测试合计19项（10+5+4）。不证明模型实际生成或草稿事务已接线。

后续新增上传策略/接收/预检查询及createSkillDraftFromRun草案，4项测试通过，最新契约共23项。失败归因引用复用RuntimeFailureAttributionRefs，派生草稿校验来源版本属于run且血缘一致。Agent pin核对后复用已有setAgentSkillPins及expectedVersion，不另造一套版本锁。

剩余设计缺口：组织开发权限的具体操作增量、Model/MCP既有操作的可执行字段增量、完整UI与feature四元组覆盖。上传限额值与对象保留周期仍须纳入同一次签核。具体流程见development-operation-deltas.md；Model/MCP操作与UI规格见runtime-operation-deltas.md、runtime-ui-interactions.md与composite-model-mapping.md。覆盖表尚不能标为闭合。

Model/MCP第一组可执行delta已加入capability-admin-deltas.ts：继承现有register/configure/probe/admission/enable/discoverRemote操作，补配置版本、single映射与显式凭据变更；4项定向测试和contracts typecheck通过。仍需列表/路由/停用操作的字段增量及完整端到端验证；文件未导出为生产入口，现有接口继续拒绝新字段。

后续已补listModelPool、listSelectableModels、routeModelCall、listModelReferences、disableModel可执行delta；路由输入的模型与revision必须成对，返回binding必须匹配degradedTo或selectedModelId的实际目标。管理与运行绑定共享provider/upstream校验。该文件增至6项测试。仍需独立review、完整UI、权限与feature覆盖、生产持久化/路由证据，不能以schema通过宣称闭环完成。
