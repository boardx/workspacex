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

剩余设计缺口：上传操作/预检额度、AI候选差异基线、Agent配置/绑定CAS与失败运行派生草稿、组织开发权限的可执行schema。具体流程见development-operation-deltas.md；Model/MCP操作delta见runtime-operation-deltas.md与composite-model-mapping.md。覆盖表尚不能标为闭合。
