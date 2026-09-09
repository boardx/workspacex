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
