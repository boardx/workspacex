# 开发闭环尚需补签的操作

这些是尚未实现的 API 设计增量，不是已上线的路由，也不代替可执行 schema。公共请求均由服务端从会话解析组织与操作权限；对象 ID 不构成授权。错误使用已有领域错误，缺少的码需进入同一契约审阅。

## 空白创建与 ZIP 上传

`createSkillDraft` 接收名称、描述和幂等键；目标组织由当前会话解析，服务端生成skillId、draftId、初始revision与包含SKILL.md的快照。新建按钮进入编辑器，不自动发布或绑定。重复同键同请求返回原草稿；同键不同内容拒绝。同名仅提示，不按名称覆盖。更细的团队开发空间选择须在权限增量签核后扩展，当前草案不靠客户端orgId判权。

核对当前代码后，现有files.uploadArtifact是项目级multipart上传，返回ingestionRunId/artifactId；chat-file-upload.uploadAttachment绑定线程且白名单不含ZIP。两者都不是可直接拿到uploadId的通用可恢复上传会话。不得宣称已有此能力，也不扩张聊天附件白名单来承接Skill代码包。

拟新增Skill用途的临时包上传适配操作，复用文件模块的对象存储端口、字节核验和失败清理机制，使用独立开发空间权限。服务端生成作用域内uploadId后预检：上传完成、实际字节数、内容类型、解压后总大小、文件数、深度、规范路径、符号链接及压缩比。限额由服务端策略返回给 UI，前端提示引用该策略，不硬编码第二份限制。只接收完整对象并计算服务端digest；客户端文件名、MIME与哈希均不能作为通过证明。

上传页分别显示传输进度与服务端预检结果；二者不能合成一个“导入成功”。未完成、隔离、超限、过期上传不能生成候选。当前没有分片续传实现：首版明确传输中断需重新上传，已接收完整包的预检任务可以查询恢复；不能把导入任务恢复写成字节断点续传。预检失败保留来源表单，指出具体文件路径。导入代码不执行任何安装脚本。对象保留/隔离周期需在正式schema接线前纳入服务端策略。

## AI 生成可审阅差异

`proposeSkillDraftPatch` 输入精确 skillId/draftId/revision/digest、用户意图、显式选中的上下文文件与 modelConfigRef、幂等键。返回异步任务 ID；任务只读取该快照。生成结果存储 proposalId、基线引用、结构化文件操作、逐文件差异和摘要，不修改草稿。

`getSkillDraftPatchJob` 按作用域返回排队、生成中、含可审阅proposal的成功结果或失败结果。失败保留用户意图与选中文件；重试创建新的任务。模型返回的路径和内容需重新进行规范路径、大小及manifest完整性校验，不能把模型输出当可执行命令。

`applySkillDraftPatchProposal` 只接受 proposalId、期望草稿 revision/digest 和幂等键，由服务端加载原始补丁并以现有原子草稿变更事务应用。客户端不能用“已审阅”布尔值或自带 diff 充当补丁身份。用户取消只关闭审阅，草稿不变。基线过期时返回差异与冲突入口；不得静默覆盖新内容。部分接受要求显式的文件操作选择，且整体结果仍必须包含有效 manifest；第一版原型只承诺整份接受或拒绝。

## Agent 固定绑定与运行反馈

Agent复用已接线的setAgentSkillPins：输入有序skillVersionIds及expectedVersion（当前agents.published_version_id），整体替换并创建新的不可变Agent版本。不要再加一套含义重复的配置revision或将其误认成未接线的mountSkill。Skill新发布版本须落在现有skills/skill_versions身份体系，服务端解析版本所属skill及内容摘要；若多文件快照新增digest则扩展版本读取与运行快照，而非另建不兼容pin集合。草稿ID或试跑ID不可冒充发布版本。既有run继续持有启动时快照。界面必须显示“当前绑定”和“本次将绑定”的版本，不能从列表最新项推断用户选择。

失败返回复用 run 查询，不由浏览器提交归因对象。服务端从 run 快照派生 Agent/Skill/Model/MCP 引用；依据当前权限给出允许的修复动作。普通成员可查看自己可见的失败摘要，没有开发权限时不显示可写入口。404/无权限的返回不泄漏其他组织的对象名称。

`createSkillDraftFromRun` 是显式动作：输入runId、该run中选定的sourceVersionId和幂等键；服务端在当前组织从历史发布快照新建开发草稿，并保留run来源引用。若已有草稿，不自动覆盖，允许打开现有草稿或创建独立副本。再次提交返回同一副本。运行日志和用户输入不默认写进Skill文件或AI上下文；用户显式选择可见片段后才用于开发。

修复模型或 MCP 后回到原 run/工作台，保留用户正在查看的测试输入与草稿位置。重试是新的 run，链接 previousRunId，不修改历史结果，不自动重放有副作用工具。发布新版本、更新 Agent pin、重新运行分别可观察、分别留证据。

## 必须形成的验收证据

| 场景 | 成功与反证的共同出口 |
|---|---|
| 空白创建重复提交 | HTTP 返回相同草稿 ID，数据库仅一条草稿；同键不同内容无新增 |
| 恶意或超限 ZIP | 真实上传对象进入预检后拒绝，无开发草稿、无脚本执行、无可绑定版本 |
| AI 补丁取消与过期接受 | 浏览器草稿内容与数据库 revision 均不变；无模型伪造路径写入 |
| AI 补丁接受 | 逐文件预览与新快照相同，事务失败时无部分更新，旧发布内容不变 |
| Agent pin 并发更新 | 旧 revision 请求拒绝；新 run 与在途 run 分别引用各自精确版本 |
| 从历史失败开发 | 副本来源匹配 run 快照；跨租户 run 拒绝且无副本；重复点击不重复创建 |

上述新操作已在skill-development.ts形成独立、未导出的可执行草案，新增两组各4项契约测试。上传策略由服务端返回，multipart元数据不接受客户端digest/validated证明；完整接收后创建预检job，只有成功结果携带archiveDigest。失败派生草稿结果校验来源版本在原run中且草稿血缘匹配。尚无controller、持久化、队列或对象存储接线；Model/MCP操作delta与权限增量仍待闭合，覆盖工作表不能标为完全通过。

## 普通仓库兼容分类与适配增量（2026-09-10，待签核）

新增review-only `skill-source-assessment.ts`，先以assessSkillImportSource/getSkillSourceAssessment得到compatible / needs-adaptation / unsupported。compatible携带既有SkillImportPreview；普通代码仓库无需伪造candidate即可返回固定pin、文件清单、许可证证据路径、依赖/脚本清单和缺失要求。

createSkillAdaptationDraft只接收assessment引用、摘要、名称和明确所选文件；服务端读取原评估并校验权限/有效期。skillAdaptationExchange拒绝非适配来源、错评估/摘要/来源pin、清单外文件。输出必须为revision1、无发布血缘、带固定来源pin的新草稿；原源码仅进入references/imported/，生成SKILL.md及待完成说明，不执行源码、不自动AI读取或发布。原有SkillImportPreview仍表示确有候选的导入预览，未放松为任意“成功空候选”。

4项契约反例通过，尚未接业务API、存储或完整适配编辑器。许可表达式null表示未识别，不能推断为可自由再分发；选择和保留许可证的最终流程需与UI一起签核。新错误闭集需在正式接线时接入HTTP映射，不能只改schema。
