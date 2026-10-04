# 固定 9b25 维护发布的验收顺序决策

应用：`9b25bfa65662b96c0826fe67506b562ea46aa6d0`；基线：`ba6343199f3c834d6a198f83d0c771614292c82b`。

当前维护契约要求所有 writer 被封锁，迁移完成后先激活、验收，再恢复 writer。真实 hello、ASR、Skill/Tool、PDF 产出需要写入。普通 API 角色在 NOLOGIN 时无法执行这些流程。新源码已实现真实动作，但在任何 hold/指针/流量变化前明确拒绝 `MAINTENANCE_ACCEPTANCE_WRITER_LANE_NOT_IMPLEMENTED`；不能用 profile flag 将此缺口改成通过。

## 方案 A：隔离候选验收，然后生产恢复写入后做公开验收

1. 在独立恢复环境，以固定三库备份、共同快照和对象闭包建立候选数据面；使用固定六镜像完成迁移和六条真实业务流程。
2. 绑定应用/镜像/迁移计划、数据恢复与对象证据、环境与账号清理证据为独立 artifact；生产维护开始前独立重验该 artifact。失败即不进入生产。
3. 生产保持 FD9/hold 和全 writer 封锁，执行 exact 迁移、完成证据及真实只读运行验收。
4. 按批准的恢复写入顺序恢复服务，在公开环境重新验证六条实际业务流程；只有此步骤通过才声明发布成功。
5. 公开验收失败不得镜像单独回滚：停止新增写入并形成新维护/三库恢复计划，保持受锁的可恢复状态；恢复动作需绑定已有风险批准及真实备份证据。

这是建议方案，但需要明确维护状态机与最终公开验收之间的责任/锁/失败恢复契约。当前源码没有偷偷调整原有顺序。

## 方案 B：生产保持 hold，开放受控验收写入 lane

只允许私有入口、唯一候选 API、明确单 tenant 验收账号与窄权限角色、限时操作和逐 run 终态记录；所有其他 writer 保持封锁。需要扩展 fence/controller 的角色与会话契约、独立验证异常收回能力，并逐项批准实际权限变化。不能通过临时恢复普通 app_rw 的 LOGIN 实现。

## 尚未执行的动作

没有连接数据库、启动候选服务/容器、恢复数据、安装工具、执行生产迁移、停机、创建权限或切换流量。源码与纯测试的授权不等于以上动作的批准。生产审批包还必须包含实际三库/对象恢复证明、六镜像封存、全工具清单与回滚/恢复证据。

## 最小顺序契约（待批准设计，不是可执行生产许可）

| 阶段 | 允许验收 | 写入边界 | 锁与失败处置 |
| --- | --- | --- | --- |
| 独立候选 | 六条真实业务流程 | 独立恢复的三库与对象命名空间，批准的单租户/账号/thread/Skill/PDF 数据范围 | 独立环境锁；不得生成生产恢复 LOGIN 的授权 |
| 生产全停写 | 固定源/镜像/迁移 ledger、诊断权限、三库连接与角色；不含经过普通 API 的认证 GET | 所有 fenced role 必须 NOLOGIN；同一 sealed 诊断连接查 drain；不启动 bootstrap、不 unpause API | 始终继承同一 FD9 和 hold generation；读前读后复验全 writer barrier；未知状态保留锁/hold |
| 经批准恢复写入后的公开验收 | 登录、hello、ASR、反馈关联、Skill/Tool、PDF | 单独批准的恢复写入阶段和测试数据范围；不得称为全停写阶段 PASS | 发布 owner 保留维护锁直到公开验收终态；失败停止新增写入并进入新恢复计划，不以镜像回滚替代三库恢复 |

实际 browser consumer 中，hello/Skill/PDF 创建并持久化 agent runs，PDF 同时创建对象。ASR 会调用实时服务，其全部存储副作用尚未证明为只读，按写入型处理。登录提交也不能用登录页 GET 替代，认证会话/审计副作用按写入型处理。`githubFeedbackRead` 的 GET 只有在已有认证会话下才是单独的只读子验收；整段 browser 脚本会先登录，因此整段仍不能在全停写阶段运行。

源码 `acceptance_contract.ts` 校验以上边界，不能执行恢复写入，也不能签发通过证据。当前顶层缺能力拒绝保留。旧 maintenance preactivate collector 会启动 bootstrap 容器和新连接，现已在调用前拒绝；它不能通过普通 provision fallback 填补维护验收。

反馈关联 use case 自身不落库，但其认证 API 在全停写 fence 中也被暂停；当前不得仅凭已有会话将该产品 GET 放入 held 阶段。认证 session store 是 Redis 写入面，登录真实提交也不是三库 SQL 只读探测。held 阶段目前只允许固定 sealed 诊断消费者读回，不允许 unpause 普通 API 来补 UI 证据。

Frozen 9b auth correction: validate-session.ts calls sessions.touch when last-active is due; login.ts records attempts and issueAuthenticatedSession issues a Redis session. Therefore even the authenticated feedback GET journey may write session state. Its business use case being read-only does not make the full journey read-only. All six product journeys are excluded from the all-writer-held phase.

## Common epoch and admission order

An independent prior rehearsal proves recovery capability, not current rollback data. Production may have written after that rehearsal; using its old snapshot for migration failure recovery can lose those writes. A separate approved capture-quiescence phase must therefore establish the canonical lock and exhaustive writer/object/DDL/GC fence, capture all three databases and objects in one interval, and retain quiescence through same-epoch independent restore proof, migration and acceptance state transition. Calling capture-quiescence a different attempt does not make it downtime-free. Admission must distinguish recovery-capability proof before quiescence from fresh current-epoch proof before DDL; demanding fresh proof before the very fence needed to create it is a startup cycle. Existing release state machine has not silently been reordered to skip either proof. An alternative requires actual WAL/PITR plus OSS change-log catch-up to the final cutover epoch, which has no current evidence. Neither historical CMS files nor equal snapshotId strings suffice.

## Frozen 9b controlled-lane limitations (source review only)

The source cannot authorize B through a profile alone: pg-database.inTx sets caller-controlled app.current_org; credentials/login_attempts have no tenant RLS; validate-session touches Redis; OSS prefix concatenation does not constrain broad ECS credentials; Agent checkpointer setup can execute startup DDL; native sessions add socket/container writers. A production B lane needs actual immutable user/tenant role restrictions including global auth paths, scoped Redis ACL and OSS STS, no unapproved startup DDL, and exact API/Agent/sandbox/child-container leases. These require source capabilities plus individual runtime/permission approval and real negative validation. Do not silently relabel fixed 9b or claim all-writes-held while any acceptance writer exists.

A is the smallest option preserving the frozen application: isolated three databases, scoped Redis/OSS and sandbox for six journeys; separate approved production resume and public acceptance. Parent coordination has selected A for candidate source design only; this is not approval to execute production maintenance. Both options still require fresh same-epoch recovery artifacts before destructive migration.


## A 的精确阶段与失败边界（源码设计，尚未接入执行器）

| 阶段 | 必须读取的事实与证据 | 失败边界 |
| --- | --- | --- |
| A0，停机前准备 | 固定 9b 六镜像与工具身份、审批范围、隔离资源配置、既往恢复能力演练；可提前完成，不冒充当前备份 | 不触碰生产；旧演练不授权 DDL |
| A1，批准停写与排空 | 同一维护锁、全 DB/Redis/OSS/Agent/sandbox/子容器 writer 闭包、实际 drain、新 hold generation | 任一未知状态保留锁；未证实停写不得采集为一致备份 |
| A2，当前 epoch 采集 | 三库备份与完整 catalog/ACL/RLS/序列/行证据、全部引用对象与版本/原始字节；记录实际采集区间和前后 fence | 不复用跨 epoch 历史备份；任一缺口禁止迁移 |
| A3，隔离恢复和 9b 六流程 | 实际三库恢复、对象读取与独立一致性复核；隔离 Redis/OSS/账号/运行时，绑定 A2 artifact 哈希 | 生产持续同一停写 epoch；隔离 PASS 只证明候选，不是生产 PASS |
| A4，生产迁移与停写读回 | 独立消费者验 A2/A3 后才执行 exact 迁移；同一 sealed 诊断会话验版本、ledger、角色与 drain | 此时尚无恢复写入意图；仅在当前备份完整覆盖全部修改面且持续 fence 被证实时，可按已批准恢复流程无损恢复 |
| A5，单独批准恢复 writer | 先持久化 resume-intent，绑定当前锁/epoch、批准范围与服务顺序，再启动可能写入的 API/Agent 等 | 从 intent 起即假定可能产生新写入；命令超时/报错也不能退回“未写入”判断 |
| A6，公网复验 | 实际生产 commit、健康、登录与六流程；保留维护锁至终态，绑定独立生产回执 | 失败立即按批准流程阻止新增写入、保全新数据；优先前向修复或另行批准数据保全恢复，禁止旧备份直接覆盖 |

A1–A4 的完整证据必须属于同一连续停写 epoch。隔离环境可以预先准备，实际恢复和六流程必须使用 A2 当前备份重新执行；因此这部分占用停写时间。若中途释放生产 writer，则旧 epoch 作废，必须重新停写、采集和重验，除非另有已实现并批准的 WAL/PITR 与对象变更闭包追赶机制。

“生产启动后只读验收”需要拆开：容器离线 create/inspect 与 sealed 数据库诊断可在停写阶段做；API/Agent 启动可能执行 DDL、会话或租约写入，不能仅因尚未切公网就算只读。普通 API 认证 GET 也不属于 A4。当前未实现安全的 held preactivate 替代消费者，保留拒绝入口。

无损恢复不是旧镜像 rollback：仅 A5 intent 之前、全修改面已备份且连续封锁被证明时，当前 epoch 三库与对象恢复才可能保持迁移前已承诺数据。A5 之后的新写入无法由旧备份恢复；没有真实增量捕获/重放与冲突处理证据就不能承诺无损。任何恢复仍要求明确的目标、数据边界与批准，不由此文授予执行权限。

工程评估：至少还有三个依赖工作包——实际采集与独立 positive-proof/prehold 消费者、sealed held-preactivate 消费者、A 阶段执行器与审批/恢复边界集成。当前只是候选阶段设计，未实现以上链路。缺少首个正向完整 fixture 与真实隔离恢复计时，不能给可信生产 ETA；下一估时点是正向链路纯测试通过并完成独立源码审阅，停写时长还需实际备份、三库恢复、对象闭包及六流程计时后给出。
