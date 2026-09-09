# 试跑产物下载：复用既有兑付通道

只读代码审查基线8f26c8a23。skills.ts 的 TrialRunArtifact 注释提到 download-url，但当前 trial 只保存 name/mime/sizeBytes/objectKey；execute-trial-run.ts 的 storeArtifacts 仅写对象存储，未创建 file/agent artifact version。不能以注释当作已经可下载。

现有 POST /artifact-versions/:versionId/download-url 只识别 file/agent，其项目/资源可见性与试跑本人权限不同。可复用 DownloadGrantRepository、mintDownloadToken/downloadExpiry、DownloadUrlBuilder 和 GET /downloads/:token；后者是绑定principal的短时一次性授权通道，不是直接对象存储URL。当前数据库source_kind只允许file/agent。不得把trialRunId或Skill versionId伪装成artifact versionId，也不得让客户端交objectKey。

## 同一迭代内的最小改动

1. 试跑产物写入稳定artifactId及SHA-256，公开响应保留标识/名称/MIME/长度，objectKey留服务端。旧记录须明确迁移校验或显示“旧产物暂不可下载”，不以未知摘要当完整性基线。
2. 增加试跑签发入口 POST /skill-trial-runs/:trialRunId/artifacts/:artifactId/download-url，复用 issueDownloadUrl.out 的公共下载字段，但显式用 trialAuthorizationDecisionId 替换绑定 identity.authorize 的 permissionDecisionId；不能把本人读取判定伪装成旧权限判定。原 file/agent 入口保持其来源语义。
3. 签发和兑付均重用 readTrialRun/findForActor(orgId, actorId, trialRunId)，确保成功试跑及产物属于其保存清单。跨组织、同组织其他人、错配产物均裸404，不回退到项目权限。
4. 在共用grant ports/repository/数据库约束中加入真实skill-trial来源及服务端locator。抽取已授权不可变来源到签发的共用逻辑，继续复用 /downloads/:token 的原子一次性消费与审计事务。
5. 兑付读取真实对象字节，校验标识、存储键、长度、摘要，作为附件返回。不能仅返回元数据JSON后宣称下载完成；审计不能编造artifact-version或identity.authorize判定。

## 端到端验收

- 本人从试跑结果点击并获得确切字节，HTML/SVG附件不在页面内执行；隔离下载域正确传递真实会话。
- 跨人/跨组织/错配trial与产物/client objectKey拒绝，且不泄露存在性。
- 过期、转发给另一principal、重复及并发兑付，最多一次成功。
- 签发后来源删除/权限失效，不回退其他来源；篡改摘要/长度/字节拒绝。
- 审计失败事务回滚，存储故障可解释；原file/agent通道回归仍通过。

这是生产实施设计，不是已执行的下载证据。skill-trial-artifact-download.ts现已有未导出的签发proposal，服务端上下文关联组织/本人、成功trial、产物、grant locator与真实试跑授权收据；公共产物投影剔除objectKey，缺稳定ID或摘要明确不可下载。getTrialRun的读取delta引用该投影。6项下载与4项读取测试通过；真实权限/一次性事务/字节校验、旧数据迁移、试跑结果UI与签核覆盖仍待形成，C33未完成。
