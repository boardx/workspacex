# 知识图谱独立检索对照验收

2026-10-01 修复验收补充。冻结的 E3.c4 保持原样与原阈值，其 `vectorOnly` 数字根据混合回答中的“相似”引用推计，不能作为真正独立纯向量运行的效果。新路径用于真实控制检索模式，不能用通道标签替代决策质量。

## 已实现的独立运行

`KG_EVAL_RECALL_MODE=hybrid`：全文、AGE 和 pgvector 参与检索。

`KG_EVAL_RECALL_MODE=vector_only`：不调用 AGE，不执行字面检索，答案材料只来自实际向量命中。

两种对照均关闭额外强制决定、目标、偏好与个人画像摘要，避免用旁路材料补全纯向量答案。租户、候选可见性、过期/撤回过滤、证据与引用对账仍走原路径。普通配置未设置该变量时继续原有记忆策略。

启用时必须同时满足 `KG_EVAL_FIXTURE=1`、`PGDATABASE` 以 `wsx_kg_` 开头、`WORKSPACEX_DB=PGDATABASE`；未知模式或非隔离数据库启动失败。该入口是进程配置，不是向普通用户暴露的请求参数。

启动独占 AGE/pgvector/Redis 测试栈，按 `evidence/kg-experience-eval/README.md` 配置端口、数据库和测试嵌入服务后，分别运行（不要并发或复用上一个模式的 API 进程）：

```bash
KG_EVAL_RECALL_MODE=vector_only KG_EVAL_RUN_ID=vector-fresh \
  pnpm --filter web exec playwright test --config playwright.kg-recall-ablation.config.ts
KG_EVAL_RECALL_MODE=hybrid KG_EVAL_RUN_ID=hybrid-fresh \
  pnpm --filter web exec playwright test --config playwright.kg-recall-ablation.config.ts
```

当前配置固定使用可重复的回环聊天模型与哈希嵌入服务，供路径和通道隔离验收；它不是已经接入真实模型的质量评测配置。真实模型与真实嵌入需要单独的测试模型注册及配置，不得把上传环境文件中的生产数据库参数直接载入这条测试栈。

2026-10-01 两个独立进程的端到端 smoke 均通过，每种模式回答相同三题，并保存实际通道、回答和截图。它证明检索消融有效，不证明真实模型效果提升。原始结果在 `evidence/kg-user-acceptance/2026-10-01/remediation/ablation-vector/` 与 `ablation-hybrid/`。

## 真实决策质量验收的下一阶段标准

1. 使用同一真实聊天模型、真实嵌入、同一候选材料、同一权限、同一有效时间和确定的输入模板；每个模式使用独立空测试数据与新运行编号。
2. 至少 20 道冻结题，两个组织模式各完整走一遍。包含换说法、多跳因果、同名对象、大量无关事实、矛盾、过期、改口和证据不足的决策。冻结答案和相关证据后再运行，不能看模型输出改题或降阈值。
3. 从浏览器输入材料，等待真实模型抽取、数据库落库、AGE 投影与真实嵌入，再从个人新会话、项目新会话提问。逐条打开来源；记录拒绝无证据定论、明确缺失信息与区分事实/假设的行为。
4. 分别记录正确答案率、正确引用率、必要决策材料覆盖率、无依据断言率、用户核查点击数和延迟。保留至少两个选项、收益/成本/风险、人确认、实际责任人/时限/任务及后续状态的完整 UI 证据。
5. 冻结的“混合相对独立纯向量提高至少 20 个百分点”是质量目标；同样必须无权限泄漏、旧值不复活、重要来源可核查。小样本、双方满分或只出现“关联”徽章都不足以证明目标达成。

当前真实模型域名被环境代理拒绝 CONNECT，真实决策质量未运行。不能将本节标准标为通过，也不能将 `pipeline-smoke-M5-M7` 的三道题当作上述 20 题语义评测。
