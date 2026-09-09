# 上传与导入恢复提案

入口回到导入页时先读本人上传与导入批次列表，而非仅依靠页面内历史。分页游标由服务端认证并绑定组织、本人、列表种类与固定ID范围；其他人的数据不进入结果。限制详情复用已有 getSkillImportUploadPolicy，保留 policyRevision，不在UI另写一套限额或TTL。限额实际数值仍需随签核材料确认。

上传预检 job 状态与字节保留状态分开。getSkillImportUploadJob 是原操作的明确 envelope delta，增加 resourceRevision 与 retained/expired/discarded；成功预检仍只复用原 expiresAt。过期/已丢弃的元数据可供本人查看，字节不能再被消费。没有承诺中断网络传输后的断点续传。

运行中的预检可以明确取消：资源CAS阻止迟到完成写回。预检自身引用允许取消；外部来源消费者持有引用时拒绝。终态上传可以丢弃，但必须等自身与外部引用都释放；先原子写 tombstone，再按相同引用规则GC，不能级联删除已导入草稿或发布版本。重复同一请求返回服务端幂等收据，不重复递增版本；同key不同请求报冲突。

契约位于 skill-import-recovery.ts，复用原Job/Batch/Policy，无生产导出。10项测试覆盖CAS、身份串换、假分页、引用中的丢弃、运行中取消、取消后旧完成、过期及幂等重放。真实列表、认证cursor、worker fencing、事务和GC尚未实施，C35保持进行中。

新增 /preview/ai-capability-studio/uploads 独立fixture，展示示例policy、running与expired上传、取消/占用释放/明确丢弃与批次草稿。4项组件测试及独立只读审通过，并已真实浏览器验证取消后迟到结果拒绝、占用未释放时丢弃失败、释放后版本+1并保留批次展示。此“草稿保持原样”只证明页面fixture未改变，不证明服务端无级联删除。外部消费者阻止取消在契约层有测试，UI仅演示外部消费者阻止丢弃。页面明确固定演示时间、刷新重置，不读取真实列表或断点续传。

## 发布版本试跑的恢复边界

skill-trial-read-deltas.ts 继承已有 getTrialRun 路径，在所有状态返回原始versionId/input，并与授权存储行及成功结果做关联；失败时也能看到原输入，不能错误显示当前版本或新输入。queued/running不能带成功结果或失败信息；succeeded/failed必须有对应结果且互斥。3项反证测试通过。

此delta仍是发布版本试跑，不能冒充工作草稿试跑。输入/stderr读取保留原actor-scoped 404。产物字节下载、完整执行日志、失败归因接口实施及历史MCP快照尚未接线，C33保持进行中。
