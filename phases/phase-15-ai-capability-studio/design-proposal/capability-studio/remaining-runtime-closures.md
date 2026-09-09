# 来源基线与草稿试运行：待闭合的执行链

本文件记录 da4ecce43 后续设计任务，未建立新接口权威，未表示生产能力完成。

## 来源重新绑定后的首次比较

`packages/contracts/src/skill-source-binding.ts` 的 baseline-required 是必要的阻断态。当前 rebind 保留本地文件，无法证明新上游曾是这些文件的共同祖先；不能用本地快照冒充 base，也不能沿用旧来源 baselineId。

下一步以现有 `skill-development.ts` 的 checkSkillUpstream/mergeSkillUpstream 为入口增量：服务端建立不可变比较记录，关联当前 draft CAS、来源 pin、选中候选、实际上游文件清单及每个路径的内容摘要。首次重绑定比较必须明确称为“建立新来源基线”，界面并列当前文件与新来源，不宣称三方合并。用户逐项保留本地/采用上游/删除/手动编辑；全量路径覆盖且无重复后，原子写入结果草稿与新上游不可变基线。此后才可用上一基线、当前本地和新上游进行真正三方比较。

需验证：新增/删除/重命名路径覆盖、旧比较重放、draft CAS 冲突、来源移动、授权撤回、未解决路径、重复决议，以及提交失败不产生半份基线。仅保存摘要不能证明对象字节存在；需数据库事务与对象存储集成证据。

## 草稿试运行的结果与产物

`skill-development.ts` 的 TrialJob 目前成功只提供 TrialEvidence，非成功态没有固定草稿与输入关联。现有 `apps/api/src/interface/controllers/skill-trial-run.controller.ts` 处理已发布 versionId；application readTrialRun 使用 findForActor。不能把 draftId 填进 versionId，也不能让后台管理员读接口悄悄放宽既有个人试运行权限。

下一步在现有草稿 job 查询上定义增量：提交时固定 skillId/draftId/revision/snapshotDigest、sampleInput 与实际依赖快照；所有终态保留这些关联。成功结果包含输出、耗时、消耗和产物引用，发布依据必须关联同一执行记录且测试确实通过。失败保留脱敏诊断与归因；任务执行成功和质量测试通过要明确区分。复用公共产物 metadata/projection，但草稿产物授权与存储 locator 需明确新增 subject，不能套用当前仅已发布 trial 的下载签发路径。

需验证：刷新/后退仍能读同一 job；提交后修改草稿不会改变正在运行的快照；旧成功结果不能发布新 revision；依赖配置变化与MCP撤权有明确拒绝；跨组织/跨 actor 不泄露；worker迟到/重试不覆盖终态；真实模型输出的实际文件可下载且内容摘要一致。schema 正例不是这些动态事实的证据。

## 首次基线交互的评审草案（待收敛到契约）

1. 在来源页的“建立比较基线”创建不可变审阅任务：输入复用现有 ExactDraft，加幂等键；服务端从 baseline-required 中定位已选 preview/candidate，重新核对个人来源授权、来源 pin 和有效期。响应给出 reviewId、到期时间与本地/新来源路径并集，不包含虚构 base 一栏。
2. 用户通过现有文件内容读取能力查看两侧；读取须增加明确的首次绑定审阅模式并绑定 reviewId。不能让历史三方读取接口把首次绑定 local 当成 base。二进制只能选择已有一侧或删除，文本可手工修改；采用已有文件也要验证实际字节摘要。
3. 提交复用现有 merge 决议联合类型，但请求必须绑定 reviewId、审阅摘要、ExactDraft 和幂等键。每个路径恰好一个决定；选 local/upstream 必须该侧存在。空结果或缺失合法 SKILL.md 必须返回可操作校验错误。
4. 同一事务写草稿新revision、新来源基线和审计，保留已发布版本及 Agent pins。新 baseline 指向“本次已审阅的新来源快照”，不能指向用户合并后的结果；结果相对该基线的差异就是后续用户修改。响应 sourceBinding 才能变 established。
5. 模型/工具授权不会因换源自动增加。一次合并后需要重新试跑再发布；失败留在当前草稿，发布历史可见且可恢复。

本节不新定义源内容摘要算法、下载TTL、权限角色或重复文件清单。真正实现前，需将审阅记录和既有 getSkillUpstreamFile/listSkillUpstreamFiles 的 mode delta 一起签核，避免首次比较与后续三方比较成为不兼容的两套文件读取逻辑。
