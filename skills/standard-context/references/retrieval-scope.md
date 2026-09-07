# 检索范围选择

- 省略 scope 或 `current-files`：默认授权附件检索。只有 query、可选 projectId 和 limit；不要传 queryTask。新上传的资料未进入组织索引时，应明确使用此范围。
- `organization-index`：现有组织索引全文检索，返回 scopeMode=organization-index-fts、coverage=primary-file-index。每个来源仍受当前用户权限约束；项目参数只能收窄到已授权项目。并非所有组织资料都已索引。
- `organization-hybrid`：仅当服务端已配置模型与索引时可用，不由模型填密钥或配置来启用。queryTask 可选 search/answer/research/decision-support，默认 search；其他 scope 不接受 queryTask。按实际 retrievalPlan 描述执行的通道，不声称每次都有五路、图种子或所有访谈同意覆盖。未配置、不可用或查询需要尚未接入的图种子时，工具会拒绝；说明此范围未完成，只有用户任务允许时才显式改用可用范围。

三个范围都使用真实 sourceId/versionId 再调用 wx_knowledge_read。保留完整标识、sourceVersion、accessibleAt 与 citationAnchor；索引来源使用真实 segmentId/artifactId/artifactVersionId/anchor，附件来源使用真实 threadId/messageId/sourceRecordId。不要编造页码或用标题猜版本。权限撤销或版本变更后不得复用旧摘录继续作证。

配置是否可用以实际服务回执为准，包安装不代表组织索引已完成、重排已启用或用户拥有所有来源权限。
