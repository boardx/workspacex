# 新增一次S2：独立来源审计

本记录只覆盖用户新批准的一次独立S2补测。A1为唯一栈owner；A2不启动资源、模型或修改角色、钱包、账本。本次唯一S2实际请求终态failed，来源与隔离核对通过；不以恢复或native派发事实替代教学成功。

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

## 唯一新增S2：实际失败运行只读审计

`actual-failed-run-report.json` / `.log`为真实app_rw只读审计，退出0。运行`40539aa6-2732-4661-9665-913013af806d`终态**failed**，保留A6的`MODEL_CALL_FAILED`结果；没有助理回复或阶段完成。没有新send、resume或数据修改。

- actual Agent版本是canonical `agent-version-fixture-428d072b-cf41-465b-86f7-6b02fe39136f`，不是旧echo；唯一focus为实际`aidt-empathize`版本f4341571…，完整包匹配已批准发布。
- S1 V2、S2 V5实际保存投影与冻结材料逐字匹配，均未截断；snapshot `326557fd…`、block `e9527c82…`的canonical hash一致。
- 两条旧run、原6条消息、两类snapshot/application子集及旧不可变版本hash保持；旧S2仍cancelled。
- 新local thread与旧run线程分离。实际journal记录的remote thread namespace与remote run也均与旧记录不同；这里不声称读取了LangGraph完整checkpoint正文。
- A6早期frozenReceipt为`assembled`。之后独立DB审计读到真实`message-dispatch-observed`，时间`2026-11-16T14:20:48.750Z`，hash等于冻结block。保留两个时间点，不改写早期receipt。
- native提交观察**不是**供应商内部收到或推理成功的证明。run仍失败，无resume。物理请求失败与结算细节等待A1安全计量诊断，不依据此次失败推测成功消费或自动再发。

新增S2独立预算只占用这一条。旧两账SHA保持，不将失败请求从账本删除或释放后重发。`modelRequestsSent=0/dataWrites=0`仍仅指A2审计动作。

### 后续安全计量诊断（不是成功或零费用结案）

A1的[实际计量记录](../../a1/s2-supplement-20261116/native-failed-accounting.json)与[正常关窗回执](../../a1/s2-supplement-20261116/attempt02-paid-window-closed.json)进一步确认：本次一个native任务内部实际有2次physical attempt和2条failed usage记录。`tokens_total=0`且prompt/completion为null，不能解释为供应商确定未收到、实际消耗确定为零或无需计费。两个credit request仍pending，分别reserved 3412/5217 hundredths；held与remainingHeld各为8629，balance仍19981.70测试额度。没有已结算或退款证据，不合计两种held字段来推断最终费用。

原两条运行对应的已结算记录保留；旧两预算不变。本次S2独立账只占这一条native任务，两个内部physical attempt不冒充两个新增学生请求。A1正常API-only关窗前后财务记录逐行不变、active为0；没有手工释放hold、改余额、reconcile或再次派发。

DB journal还保留`failed`事件（14:20:50.442Z）。其中封闭fallback码`AIDT_CONTEXT_UNAVAILABLE`不能单独证明Stage来源或权限失败；本次实际保存投影、hash及当前授权的只读核对全部匹配。A1当前安全错误投影为`APIConnectionError / Connection error`，具体网络根因仍由零网络诊断继续确认。不要将该投影升级为供应商已收到或确定未收到的断言。

本轮最终结论是：**来源、旧数据保护及新旧命名空间核对通过；新增S2模型任务失败，结算待处理，教学验收未完成。**
