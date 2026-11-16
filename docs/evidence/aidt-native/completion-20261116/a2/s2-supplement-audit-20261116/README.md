# 新增一次S2：独立来源审计

本记录只覆盖用户新批准的一次独立S2补测。A1为唯一栈owner；A2不启动资源、模型或修改角色、钱包、账本。S2新任务结果未到时，不以旧run或恢复成功代替。

## 已完成：恢复后旧数据基线

`baseline-report.json`为真实`app_rw`只读连接结果，退出0。审计身份仍是实际org admin / project owner，不证明普通学生模型付费权限。只在显式获准的计划SHA `59500507741bccff83fc30c741c8ce6846fa69d7bb7cd651d04a4fb9a6cb62f4`绑定分支下接受“原逻辑DB、新transport”的组合；普通栈的derive守卫未放宽。

独立核对了当前live owner启动时间、stack admission文件、13个实际port lease、容器归属及其真实loopback PG映射；原dump、manifest和旧两账SHA未变。未读取凭据字段，没有source私密env。历史empty-target来源是已验证的恢复receipt；本次审计不把它冒称当前数据库仍为空。

从真实DB按两条旧run ID读取旧run、generic和AIDT快照、application子集，按检查点截止时间读取原6条消息，逐行JSON哈希与原baseline相等；旧不可变Agent版本哈希相等。旧S1仍succeeded，旧S2仍cancelled。未把合法新append要求为整表哈希不变。

审计不调用`verifyRestoredReceipt`重新假定五executor为零，也不核当前服务处于零收费窗；A1已经明确单独开启本次S2窗口。`databaseReadOnly/modelRequestsSent=0/dataWrites=0`仅说明A2审计连接和脚本，不代表实际S2没有运行。

## QA变更及反例

- `apps/api/tests/aidt-run-context/audit-restore-binding.ts`：QA-only私有回执、批准计划、live资源及旧预算绑定，不含DB/model启动或写入。
- `audit-real-run.ts`：保留原普通栈路径，增加显式approvedRestorePlanSha256；保留真实成员、thread visibility和Guarded披露；新run将核原旧子集与新local/remote命名空间分离及canonical Agent版本。
- `audit-binding-unit.test.ts`：12项定向测试通过，涵盖错误批准SHA/计划修改/org/DB/旧compose/port/owner/非空目标/启用seed的拒绝。
- 最初QA将真实runtime误假设为包含PGDATABASE；实际runtime仅投影WORKSPACEX键。真实结构反例1红后，从已批准plan精确提供原逻辑DB，11绿，随后补充approved nonce与资源seed绑定负例至12绿；这是QA适配修正，未改生产或权限。
- scoped TypeScript及diff检查通过；未重复已通过48项或重新运行PG套件。

**后续范围限制：**旧legacy/S1两账必须保持原SHA，仅适用于本次S2独立账。未来S3–6/SUM可能合法追加原预算，不得删除本门来迁就，亦不得把预期hash拒绝误报为隔离故障；需单独核明确授权的journal前缀与append。

## 待实际S2后核对

精确保存来源、冻结哈希与独立receipt；原human正文哈希；新Agent版本；旧run/message/snapshot/版本未被改写；新local thread和journal观察到的remote namespace/run与旧S2分离。审计仅核服务端材料及派发事实，不声称独立读到了供应商内部prompt或LangGraph全部checkpoint正文。新S2尚未完成，当前不标教学通过。
