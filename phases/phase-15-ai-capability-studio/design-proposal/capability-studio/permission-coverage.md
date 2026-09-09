# 开发与运行权限覆盖（待签核）

本表是设计提案，不授予权限、不声明新端点已接线。组织身份与资源可见性复用现有 guards、IdentityRepository 和 guarded 数据路径；客户端不提交 actor/orgRole 作为授权证明。

## 当前实现证据

- URL 发现/导入在任何来源请求之前检查组织 admin：`apps/api/src/application/skill-import/discover-skills-from-url.ts`、`import-skill-from-url.ts`。
- 已有 Skill 内容编辑和 Agent pin 写入同为组织 admin：`application/skill/edit-skill-version-content.ts`、`application/agent-skill-pins/set-agent-skill-pins.ts`。
- 既有发布版本试跑 `application/skill/submit-trial-run.ts` 仅检查组织成员，不能据此推导该成员可以读取或试跑新开发草稿。
- MCP 远程发现先验证组织 admin：`application/mcp/discover-remote-server.ts`。连接成功与安全评审是独立维度。
- 列表/详情必须继续使用 guarded 可见性判定；不能因为请求里携带同组织 ID 就跳过对象权限。

## 拟采用边界

本迭代默认沿用组织 admin 管理开发空间；界面中的“开发者”是工作职责，不自动新增角色或给普通成员写权限。若需要委派非 admin 开发权限，须作为同次签核的显式权限增量，明确授权主体、资源范围、撤销和审计后再实施，不在控制器里临时判断字符串角色。

| 操作组（可执行草案中的名称） | 提案前置 | 必须拒绝的反例与无副作用证据 |
|---|---|---|
| getSkillImportUploadPolicy、uploadSkillImportArchive、getSkillImportUploadJob | 组织 admin；上传对象和任务属于该组织 | 匿名/成员拒绝；跨组织 uploadId 不可见；拒绝时无对象写入或来源出站 |
| createImportPreview、getImportPreview、confirmImport | 组织 admin；来源连接可用且获授权；预览归属/摘要/有效期一致 | 他组织连接/预览、过期、篡改摘要拒绝；鉴权先于 GitHub/HTTPS 请求；确认不重复建草稿 |
| getImportBatch、getImportJob、retryImportJob、cancelImportJob | 组织 admin；批次和任务同组织、状态允许操作 | 猜测他组织任务 ID 无状态泄漏；重试不重复成功项；取消不回滚已有外部副作用 |
| createSkillDraft、getSkillDraft、getSkillDraftFile、mutateSkillDraft、importIntoSkillDraft | 组织 admin；草稿资源可写/可见；CAS；文件受清单约束 | 普通成员不能沿发布版本读取权限读取开发稿；跨组织草稿不可见；CAS失败无部分文件写入 |
| proposeSkillDraftPatch、getSkillDraftPatchJob、applySkillDraftPatchProposal | 组织 admin；草稿/提案关联；明确应用与CAS | 无权限先拒绝再调用模型；他草稿提案不能应用；旧基线零写入；凭据不进入AI上下文 |
| runSkillDraftTrial、getSkillDraftTrialJob | 组织 admin；草稿可见；运行依赖逐项授权 | 成员的既有发布版本试跑权限不扩展到草稿；无权限/已撤销依赖在出站前拒绝；日志和产物同组织 |
| publishSkillDraft | 组织 admin；当前草稿与服务端试跑证据匹配；复用现有发布审核规则 | 客户端自报测试成功无效；跨组织run或过期依赖不可发布；草稿保存不改变发布版本 |
| checkSkillUpstream、mergeSkillUpstream | 组织 admin；来源连接授权；草稿CAS与固定上游 | 连接被撤销后不继续取私库；旧合并预览拒绝；冲突未决不静默覆盖 |
| listSkillVersions、getSkillVersion、rollbackSkillVersion | 开发空间默认组织 admin；历史资源可见；恢复写入检查CAS | 他组织历史版本不可读；恢复只形成新草稿，不改历史或Agent pin |
| createSkillDraftFromRun | 组织 admin且同时可见运行、Agent版本和来源Skill版本 | 单有运行ID不能读取私有能力；失败引用不能越权；来源版本必须属于原运行；不自动重放 |
| Model管理增量及MCP重连/授权 | 复用既有管理员门、凭据密封、服务器/工具范围与评审 | 连接不等于放行；撤销角色后旧页面不能保存；跨组织CAS/凭据引用拒绝；无敏感回显 |
| 现有 Agent pin、项目聊天和产物读取 | pin写入仍admin；运行/产物沿项目成员和能力可见性规则 | 不能借开发草稿绑定运行；已有快照不可变；他项目成员不能读取产物字节 |

## 尚需落实的验证

每一组需要 HTTP、数据库和出站调用计数反例；隐藏按钮不是授权验证。至少覆盖 admin、普通成员、无成员关系、跨组织同名对象、撤权后的旧页面。任务读取和异步执行均重新校验适用权限，不能只在提交时检查一次后永久授权。

私库来源连接生命周期的列表/创建/授权恢复/撤销操作尚未映射到确切既有API，这是签核前设计缺口，不能用 authConnectionId 字段存在当作已支持私库。发布审核与项目成员角色细则也需引用原有契约并逐一对照，不在本文另造状态枚举。
