# 独立真实运行来源审计

复用A1唯一stack-context-04，不创建新栈。QA脚本：`apps/api/tests/aidt-run-context/audit-real-run.ts`。脚本启动强制应用身份`app_rw`，通过PG startup option设置只读，再独立`SHOW transaction_read_only`核实；仅真实tenant会话、实际组成员及thread visibility判定之后披露真实Guarded快照和Stage材料。没有API请求、模型provider、执行worker、迁移或账本操作。

输出仅坐标、哈希、字段名称及核对布尔值；学生正文、模型回复、Skill全文、远端凭据和私密配置均不写入报告。现有Skill完整包通过正常own/platform published/enabled读口读取，在内存核对已批准课程包digest，不声称官方账号或import lineage。

## S1实际结果

运行`68880459-6de1-43a8-a909-0a969f03a7a8`：**只读审计退出0**。实际org/principal由A1的`context-stack04-s1-accounting.json`独立DB核对提供，不根据账号或命名猜测；本次实际模型账户为org admin / project owner，不能据此证明普通学生的付费权限。

- 实际单一focus是`aidt-understand`，冻结version与actual agent_run pin、A6预先读取的mount及receipt相等。
- 冻结S1 V1的实际保存投影与参考材料逐字在内存匹配，未截断；审计时head已是学生主动保存的V2，旧快照未被替换。
- canonical selector、snapshot、reference block三种hash均与真实存储一致；原human消息正文hash与A6发送内容hash一致。
- 真实journal有assembled及message-dispatch-observed；组装/派发hash均为`b06ed80b6433fd4a53db7cae02793a6a2907742066f924cf770a1f44e3f35e41`，与冻结block和独立GET receipt一致。没有resume事件，不补造继承事实。
- 保留个人成果、原件字节、无来源教师点评及lineage缺口；保存与确认不是研究成立。

安全事实见`s1-report.json`。这证明实际服务端冻结源及派发观察彼此一致，**不是独立的供应商内部prompt或推理审计**；实际付费运行成功及物理请求/结算另见A1/A6本轮证据。审计自身模型请求0、数据写入0；不能把这两个0写成S1模型没有运行。

## 可复用执行

```sh
pnpm --dir apps/api exec tsx tests/aidt-run-context/audit-real-run.ts \
  /absolute/private/runtime.json /absolute/safe-request.json \
  /workspace/scratch/aidt-source-audit-20261116/stage-report.json
```

safe request仅包含实际`orgId/userId/projectId/threadId/runId`，可选精确expectedSelector、expectedSkillVersionId、独立GET receipt、expectedHumanTextHash。它不含token或学生正文。运行前从A1核实实际principal/scope，从A6获取已完成run；未知身份或范围时失败关闭，不能从快照作者反推并冒用身份。标准隔离seed/DB/compose需一致，只读读取既有compose的实际PG loopback端口，不source CN.env。

本次scoped TypeScript退出0，源码diff检查退出0。无参数执行以明确错误码退出2，未连接任何资源；不把该准入检查算成功的真实来源审计。后续S2–S6/SUM待同一真实链完成后逐run复用，不提前标通过。
