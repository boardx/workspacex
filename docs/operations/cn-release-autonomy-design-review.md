# CN 发布自主执行：方案级独立审查

日期：2026-10-12。基线 HEAD `8c5d4eac8dd9d44b9837fc38a0e754b54ddda6cc`，当前 `github-autonomous-release` 工作树仍在修复，本文是**设计审查，不是执行授权或最终代码验收**。只读核对入口/回执/测试；不创建生产参数、不批准策略、不触发 GitHub 发布、云写、付费资源或 A5。

## 1. 结论

当前代码已有 root-installed exact release approval、固定17阶段driver、独立A5 writer approval和恢复入口，因此**不能说每次运行在技术上必须依赖 Chat**。但尚未证明 GitHub 从冻结源版本、构建、香港传输、生产消费、发布、备份切换到A5/A6与失败恢复的完整自动接线已在同一真实隔离运行中成立。

现有A5消费的是绑定**已经产生的**hold generation、switch receipt、held-health等原始hash的静态批准文件。没有合法指针即等待。这不同于“用户事先批准条件策略，然后可信执行器根据本次fresh事实生成派生授权”。后者是本文提出的设计，**当前未实现、未批准**；不能靠预装空hash、通配target、模型判定或删审批绕过。

目标应是：人在运行前批准准确版本/目标/副作用及条件边界；运行时由固定受信代码核验全部条件、记录派生A5能力；GitHub只调度固定入口并读取事实。不把聊天在线、人工复制文件或临时脚本作为正常happy-path依赖，同时保留拒绝、撤销、未知结果和超范围恢复的人类决策门。

## 2. 已读事实与不能推断的结论

| 证据入口 | 当前实际语义 | 不能推断 |
| --- | --- | --- |
| `.github/workflows/release-cn-fixed.yml` | main上的workflow_dispatch、protected environment、专用self-hosted runner、固定sudo命令、release/recovery hash；不允许任意shell参数 | workflow存在不证明runner/sudoers/root审批/code closure已安装；没有端到端trigger/物料/授权路由实证 |
| `scripts/cn-release-fixed-driver.py` | 17阶段，原requestedAt/deadline最长30分钟；状态/显式reconcile；unknown不重复写；末尾driver不自行宣称生产业务通过 | `CHAIN_COMPLETED`仍需各真实validator和A6证据，不能把fixture fullchain当生产 |
| `scripts/cn-release-stage-router.py::admission` | clear-hold前读取`writer-resume-approvals/by-release/<release>.json`，缺失返回WAITING_FOR_WRITER_APPROVAL；读取exact批准rawSHA | 不是Chat API；也不是条件策略引擎 |
| `stage-router.py::writer_resume`及`cn-release-terminal-delegation.py::derive_writer_resume` | 读root批准，校验exact identity/target/publicOrigin/TTL、hold generation、binding/switch/status/user授权/testscope原始hash，核原15阶段真实journal | 静态预装exact回执不能事先知道新hold/status/switch hash；不允许由未来执行者自填“已批准” |
| `cn-release-approval-plan.py`及`cn-release-entry/approval-plan.md` | 离线生成完整approval和安装提案；`installationReady:false`、`approvalGranted:false`，64KiB限额 | 生成文件不是安装/用户批准/真实权限证明 |
| `cn-release-rds-backup.py` | exact上海DB/role/目标、真实SDK闭包/许可读回门、once CreateBackup和job匹配 | receipt `isolatedRestoreTested:false`；备份完成不证明恢复或迁移成功 |
| runtime-continuation模板、specializer及provenance | 模板含f0eb/5285、`upgrade-f0eb-*`路径、特定target/role；受审specializer按精确原文/pin派生 | 当前修好一个pair不等于任意版本/环境通用；不能把所有常量改成任意40hex |
| full_chain / failure_isolation / browser integration | 真实局部materializer/journal/进程/归档/浏览器，关键provider/live verifier或应用响应仍fixture | 没有真实WorkspaceX、模型/ASR/PDF、RDS restore或生产四服务身份全链证明 |
| simulation runner草稿 | 逐轮stats、固定commit门正在修复；skip/snapshot/平台/cleanup/full-suite问题已有独审账本 | 尚未独立关闭的问题不能被10轮重复执行稀释；见simulation matrix的SIM-01…05 |

A5目前的严格字段：`releaseSha256`、完整`identity`、exact`target`、`issuedAt/expiresAt`、`bindingSha256`、`switchReceiptSha256`、`heldHealthSha256`、`holdRawSha256`、`holdGeneration`、`userAuthorizationEvidenceSha256`、固定scope、`testDataScopeSha256`、`publicOrigin`。还核真实journal链与原始字节，不能退化为一组caller布尔值。

## 3. 目标执行路径（设计，尚未接线）

1. 冻结源：同时核GitHub exact source、已部署DevApp身份和required gates；`main`、公开marker与所有实际服务可能不同。记录差异，不能自动拿最新main替换已批准source。
2. 提案：离线生成 exact release approval、安装CAS/完整closure、物料/权限/空间/时间预算及候选A5条件策略。所有输出默认inactive，由人类审阅范围。
3. 批准与安装：独立可信批准/安装路径将rawSHA钉到root控制面；GitHub runner无权改审批或控制代码。不因需要自动化而新增通配IAM、root shell、长期凭据。
4. GitHub调度：单一request/attempt沿 build → transfer → consume → publish → hold/stop → backup → switch → held-health传递实际original receipts；每阶段固定输入、idempotency、进程域和只读observer。跨workflow交接通过显式hash/producer身份，不能从“最新成功run”猜物料。
5. A5判定：受信条件评估器在唯一锁内读已批准策略和当前journal/live facts；全部条件成立，才生成本次exact派生writer approval并CAS注册pointer。沿用原`derive_writer_resume`严格消费和clear CAS。
6. A6：按批准的test-data scope执行真实六业务一次，保存owned run IDs和readback/stability证据。重复读取不重发业务写。
7. 任一不确定：停止新的前向写，保留原intent/evidence。显式readonly reconcile只判断原操作，不重放。恢复必须走独立批准的能力；没有安全恢复能力时诚实阻塞，不以“自主”解释为自动删数据或强制clear。

## 4. A5预批准条件策略：最小契约

建议新增**版本化策略类型**与小型root评估器；不能默默改变现有`cn-writer-resume-approval-v1`字段含义。策略审批的是生成一次exact A5能力的条件，不是批准无条件恢复writer。

| 策略字段组 | 必须固定的内容 |
| --- | --- |
| 策略身份 | `kind/schemaVersion`、policy原始SHA、审批证据rawSHA、可信签发/安装来源；未知字段拒绝；撤销/替换以独立审计CAS，不由runner修改 |
| 版本和发布 | exact source/baseline/control、release approval SHA、artifact plan/set/proof及images seal、publicationAttempt/runtimeAttempt；如果release SHA包含policy SHA形成循环，采用明确versioned外部policy-ref/approval-ref方向，禁止两边互相自证 |
| 目标 | exact account/region/ECS/DB/runtime root/public origin；不得wildcard、跨CN/US或跨实例复用 |
| 时间与次数 | 原requestedAt/deadline不变、策略issued/expires不超deadline、最小freshness和剩余执行预算、一次性消费ID、取消门；不能靠评估时间新建30分钟租约 |
| 条件 | 完整前序receipt链、原对象rawhash/live observer、无UNKNOWN intent、当前exact五服务及旧baseline绑定、hold仍held、同一generation、host/RDS当前epoch备份及既有no-migration边界、配置/稳定密钥连续性、真实held-health、所有预算/权限未漂移 |
| 副作用授权 | 明确API recreate所含清日志、seed/worker恢复等已经披露的范围；“无SQL diff”不豁免；不能批准schema迁移/新凭据/扩权 |
| A6范围 | exact test-data scope和业务plan hash、允许的fixture/org/业务动作/外部调用上限、stable observation窗口；不允许任意用户内容外发或运行时扩大 |
| 评估器 | exact版本/完整code closure/hash、固定输入解析和validator、独立root读源；不得依赖模型判断、Chat消息、runner传入结果布尔、任意脚本或工作树代码 |

执行事务（设计）：

- 先核策略准入/取消/expiry和目标；从现有root journal及独立live observer取fresh原字节，生成观测bundle hash。不能把原策略里不存在的实际generation当历史人类已签的字面值，而应清楚记录“此generation由已批准谓词验证”。
- 同一authoritative锁/同一次CAS检查下核hold generation、receipt链与当前exact运行体；在clear前再次fresh读回，避免评估后漂移。两次观察之间不能扩大scope。
- durable `policy-consume-intent → decision → derived-exact-approval → pointer-CAS → clear-intent/actual-CAS → observation`，每份原字节/hash及因果链可审计。Crash后只读对账；不新评估另一generation来复用一次性额度。
- 派生的exact approval保留现有A5所有raw hash和原始授权证据，并以独立versioned provenance记录policy SHA、评估器code SHA、真实输入hash、观测时间、消费ID。不允许伪造人工现场签字；验证器必须明确认识这种**人类预批准条件能力**，旧静态批准路径保持兼容。
- 不满足条件：返回机器可读WAITING/BLOCKED，无clear intent；是否允许修复后重新评估同一未消费策略必须由其生命周期规则明确。未知消费/未知clear结果只能reconcile，不自动重试clear。

这些变化涉及**批准语义**，需人类明确批准策略范围并正常代码审查；本文没有给出可生效策略，也未授予评估器权限。

## 5. 组件修改与验证清单

| 组件 | 最小拟修改 | 必须验证 |
| --- | --- | --- |
| GitHub request/跨workflow交接 | 固定producer run/artifact identity与rawSHA；固定入口只收request hash/mode；结果状态与exit一致 | 错run/重放/取消/排队/失runner/已过期物料；不得因PR green就自动发布；安装状态和IAM读回不是fixture |
| root policy store/evaluator（新增） | 独立预批准条件类型、私有文件/FD/hash、exact one-use决策账本与原A5派生接口 | 外部伪policy/未知字段/expired/取消/跨source/跨target/generation漂移/TOCTOU/崩溃每个写点/双runner竞争；任何反例零clear |
| stage-router/terminal delegation | 在静态approval路径之外明确增加受信派生批准路径；保留原strict验收 | 已安装静态批准仍工作；缺两种合法能力仍WAITING；runner不能mint approval；policy不能成为所有stage通用写token |
| source/path/permission binding | 使用已批准版本能力注册及单点路径派生，保留模板provenance exact转换；API/SDK/实际root路径固定 | 新source+旧baseline、旧source+新路径/旧receipt、不同DB/role、错误实际receipt路径全部拒绝；不得放宽成任意hex |
| receipt/router observer | 读取实际producer落盘路径；原始字节身份/先后关系/terminal证据独立核验 | stdout摘要不能替代完整receipt；文件存在≠操作完成；partial文件/异步provider accepted/失ACK/改hash不重发；主端code_review修复待最终审核 |
| recovery | normal与recovery CLI终态/exit相符；精确failed-request和fresh独立scope；数据与runtime恢复分开 | waiting/unknown非成功；post-clear需rehold/stop独立能力；备份存在不算restore；不因窗口续期改原release clock |
| simulation | 固定全部输入/依赖/suite inventory、平台门、无skip假绿、隔离终止域、完整十轮 | 先全覆盖修复，再同一final commit全套十轮；任意代码改动重计；保留所有失败证据与未测量null |
| actual isolated lane | 使用真实Docker/PG/WorkspaceX/模型等批准的隔离目标；测试observer读取真实结果 | backup→restore→old/new compatibility→migration/readback→startup→六业务及失败恢复；fixture不代替；未批准付费/外发仍不能执行 |

## 6. 全局预算与恢复预算

现normal request最长30分钟，GitHub job timeout35分钟不是额外授权；每个action/验证必须服从原deadline。已记录真实build/HK/Shanghai三段440+517+530=1487秒，尚未计publish/backup/switch/A5/A6；只余313秒，**没有证据支持全链30分钟SLA**。仿真耗时不能作为真实吞吐预算。

设计应同时记录用户请求lead time、准备/传输时间、激活停写窗口、A6观察、恢复时间。可以设计“准备完成后在有效授权下申请明确激活窗口”，但必须作为新的显式时序协议，不能重写旧requestedAt、隐去准备时间或悄悄续期。策略评估必须在stop前验证剩余时间/空间覆盖之后的不可中断步骤，不能等writer已停才发现A5没有时间。

异常恢复可以有独立批准的fresh恢复窗口，仍引用原失败attempt和原clock；这不代表normal发布成功，也不允许重跑未知外部写。到期时本地cgroup结束与云端Docker/RDS操作terminal必须分别证明；远端结果未知时需保留资源/hold与只读对账能力，不能用杀runner替代恢复。

## 7. 新增高风险项与关闭条件

| ID | 风险/新增点 | 严重性 | 当前证据 / 关闭条件 |
| --- | --- | --- | --- |
| AUTO-01 | 将静态exact A5批准误当未来条件授权，或使用空hash/通配值预装 | P1 | 源码已确认当前只消费exactfacts；须独立versioned条件授权契约、明确人类批准及反例，当前未实现 |
| AUTO-02 | evaluator与release SHA互相包含造成hash循环，或两个文件互相自证授权 | P1 | 设计风险，未动态复现；冻结单向信任图/完整rawhash链，审批根必须独立于执行产物 |
| AUTO-03 | 评估后hold/runtime漂移、policy重复消费或unknown clear后再次mint | P1 | 设计风险；同锁fresh读回、exact CAS、durable one-use和崩溃并发反例 |
| AUTO-04 | GitHub runner取得写root approval/code目录的能力，以安装代替审批 | P1 | 当前workflow只读权限不证明主机sudoers最小；实际安装/权限读回及否定测试，不能为自动化加任意root shell |
| AUTO-05 | 旧source/路径/角色耦合导致新候选部分使用旧物料或错误receipt | P1 | 代码含固定模板/target及exactspecializer；逐消费者同源验证，router真实路径修复仍待冻结复核 |
| AUTO-06 | workflow exit假绿或十轮缺suite/skip/mutable snapshot，被汇总为可发布 | P1 | 已有具体矩阵SIM问题，修复中；独审逐项关闭，不以重复次数替代覆盖 |
| AUTO-07 | 30分钟耗尽时已停写，但策略/恢复未就绪 | P1 | 实测分段预算已紧；stop前全链能力/时间准入，保留独立恢复窗口和terminal对账；不得静默延时 |
| AUTO-08 | held-health/fixture六业务被当真实业务，或新策略范围允许任意数据外发 | P1 | 测试边界已确认；真实隔离业务与exact testscope/外部调用验收，策略不能扩大业务授权 |
| AUTO-09 | current-epoch backup被误写为可恢复，post-clear runtime rollback被误写为数据恢复 | P1 | RDS输出明确restore false；必须实际隔离restore/migration失败恢复证据，独立post-clear能力 |
| AUTO-10 | 取消/撤销已批准策略只改GitHub状态，现场仍继续消费旧root pointer | P1 | 新设计风险；可信撤销CAS/失败closed语义、并发clear边界与证据保留测试，GitHub标签不直接充当现场事实 |

本节设计风险均未宣称动态复现；具体既有代码缺陷与本地执行记录见 `cn-release-simulation-matrix.md`，两者不可混计。

## 8. 仍需的权限和现场前置

- 精确release与潜在条件A5策略的人类审批；授权需明确副作用/testscope/TTL/一次性和恢复边界。已有静态approval能力不是本设计的新策略授权。
- root安装闭包/CAS、protected环境、专用runner、准确sudo入口、cgroup和完整SDK/browser工具库存；不读取或传播凭据内容。
- 精确GitHub artifacts读取、香港对象权限、生产ACR/Redis验证、RDS CreateBackup/Describe、实际CloudAssistant/host权限及其期限。不新增账号、凭据、角色权限或资源以“使流程自动”作为默认理由。
- 当前真实DevApp/生产服务身份、baseline、配置与稳定密钥continuity、磁盘和global预算、完整备份/restore能力、A6业务输入；只接受原始观测，不手填成功。
- 所有新付费隔离资源、真实模型/ASR/数据外发若超已批准范围必须先有具体范围授权。本文只设计，不消耗这些能力。

**当前方案状态：需要修改并验证；未证明全自动生产发布就绪。A5现有实现不依赖Chat协议，但未来freshfacts条件授权和全链GitHub自主接线尚未实现/验收。**
