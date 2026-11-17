# S2 零模型费用后续

本轮没有调用真实模型、访问供应商或重发S2，也没有修改旧失败、三个预算账本、权限或金融数据。

## 已确认与尚未确认

| 问题 | 结论 | 证据 |
| --- | --- | --- |
| 原启动器是否遗漏CA | 是；旧源码的clean allowlist不转发三项CA并覆盖NO_PROXY，修复5df77b477已保留可信环境 | 前轮a1/s2-supplement-20261116/network-environment-contract.json |
| 这种遗漏是否能造成相同类型失败 | 受控机制已证；真实HTTPX与AsyncOpenAI旧profile在TLS阶段失败、新CA profile成功；SDK响应仅本机canned fixture | ../completion-20261116/a6/loopback-openai-tls-machine.json |
| 原40539…的唯一底层原因 | 尚未直接证明；离线限定debug/error/native/checkpoint字段只有APIConnectionError，没有cause/SSL/errno。后验试验不能补造历史进程指纹或异常 | ../completion-20261116/a2/zero-cost-followup/README.md、../completion-20261116/a3/s2-causality-followup.md |
| 已知结算状态 | 最后在线完整核对2026-11-16 14:38:14 UTC：两笔credit pending，预留86.29测试credits；用量unknown，0只是占位。没有新的供应商账单查询或结算证据 | 前轮a1/s2-supplement-20261116/native-failure-details-accounting.json |

## 实际开发与验证

- c9cf6ebb7：失败后重试A保留未发B的文本、活跃引用及新附件；A原文/id/来源/附件保持冻结，正常发送B仍清稿。4文件25项回归通过，强化host11项有重叠不相加；完整Web类型检查、lint通过。
- ebbb40272：私有安全诊断仅输出有界机械字段及UUID；cause/context最多6节点，不读异常原文、URL、header或密钥。12项stdlib测试通过，含实际内存Runtime及poll/SSE公开错误不变。既有pytest全套未跑，未以替身runner冒充。
- 084dbac1e：本机TLS/真实SDK回归，既有5环境测试加HEAD和SDK共7项通过。默认验证开启、重试0；标准端口租约、监听器与临时私钥清理通过。模拟响应不是供应商结果，不写真实usage或credit。
- 原三个实际预算账本SHA逐字保持，见journal-guards.json；限定离线工具容器已删除，无DB恢复或SQL执行。原fullstack已在前轮清理，本轮未启动。

## 下一个最小验证方案（未执行、不构成授权）

1. 如需继续真实模型链，先准备并审核最新含failed/pending的诊断状态保全/恢复路径；原两run零欠款checkpoint不含第三失败与占款，不能用来回滚或冒充最新状态。所有执行器保持关闭，核三账和财务行一致。
2. 在任何新模型请求前记录实际子进程CA/代理字段的presence与digest（不记录值），以及native/API run关联与本次安全诊断代码版本。单纯HEAD或本机mock不能代替这一步。
3. 只有新增明确一次S2任务授权后，建立新的独立一次记录，保留所有旧失败与pending；正常新线程、同approved Skill、精确保存版本，一次UI逻辑发送，失败即停，不自动推进S3或Design。
4. 每次实际物理尝试与trusted usage/credit回执分别核对。未知用量不能推0费；不手工清hold/改余额。供应商账单若需查询，另行明确外部只读授权。

人类手册新增H12草稿重试操作及M25机器边界，人工结果和签字仍留空。真实模型六步与总结E2E仍未全过；未部署、合并或声称CI通过。
