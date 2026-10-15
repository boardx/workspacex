# CN 发布自主执行：方案级独立审查

日期：2026-10-12。原审查基线 `8c5d4eac8dd9d44b9837fc38a0e754b54ddda6cc`；本次闭环更新读取本地 HEAD `f9db09b2e`。当前 `github-autonomous-release` 工作树仍在修复，本文是**设计审查，不是执行授权或最终代码验收**。只读核对入口/回执/测试；不创建生产参数、不批准策略、不触发 GitHub 发布、云写、付费资源或 A5。

## 1. 结论

当前代码已有 root-installed exact release approval、固定17阶段driver、独立A5 writer approval和恢复入口，因此**不能说每次运行在技术上必须依赖 Chat**。但尚未证明 GitHub 从冻结源版本、构建、香港传输、生产消费、发布、备份切换到A5/A6与失败恢复的完整自动接线已在同一真实隔离运行中成立。

现有A5消费的是绑定**已经产生的**hold generation、switch receipt、held-health等原始hash的静态批准文件。没有合法指针即等待。这不同于“用户事先批准条件策略，然后可信执行器根据本次fresh事实生成派生授权”。后者已有纯策略验证器（本地提交 `0ceac126d`）及待独审的 root 存储/适配器代码；**自动 Router 接线草稿已实现、正在独审，生产策略未批准、未安装**；不能靠预装空hash、通配target、模型判定或删审批绕过。

目标应是：人在运行前批准准确版本/目标/副作用及条件边界；运行时由固定受信代码核验全部条件、记录派生A5能力；GitHub只调度固定入口并读取事实。不把聊天在线、人工复制文件或临时脚本作为正常happy-path依赖，同时保留拒绝、撤销、未知结果和超范围恢复的人类决策门。

### 本轮支持边界

本轮代码交付范围是 **runtime-only 的固定发布链**，保持原 no-migration / no DNS、env、secret、topology 变更边界。对不支持的模式 fail-closed 是必须保持的设计约束，不是“已经实现这些模式的自动发布”。`normal`、`hotfix` 等分类标签不自行创建另一条执行能力，也不豁免批准或测试；DB/schema migration、web-only、Pages、任意 source/角色通用化必须有各自受审实现，否则拒绝。本文没有逐一动态证明所有外部入口已拒绝所有 unsupported mode；具体入口反例仍以矩阵及测试证据为准。

AUTO-01～10 中涉及真实云权限、安装状态、恢复、模型/业务、外发和时延的门，不能仅靠本轮修代码关闭。可交付的是受审代码、离线反例与清楚的支持/拒绝范围，完整发布 scope 仍未验收。

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

## 3. 目标执行路径（部分组件已实现，全链尚未验收）

1. 冻结源：同时核GitHub exact source、已部署DevApp身份和required gates；`main`、公开marker与所有实际服务可能不同。记录差异，不能自动拿最新main替换已批准source。
2. 提案：离线生成 exact release approval、安装CAS/完整closure、物料/权限/空间/时间预算及候选A5条件策略。所有输出默认inactive，由人类审阅范围。
3. 批准与安装：独立可信批准/安装路径将rawSHA钉到root控制面；GitHub runner无权改审批或控制代码。不因需要自动化而新增通配IAM、root shell、长期凭据。
4. GitHub调度：单一request/attempt沿 build → transfer → consume → publish → hold/stop → backup → switch → held-health传递实际original receipts；每阶段固定输入、idempotency、进程域和只读observer。跨workflow交接通过显式hash/producer身份，不能从“最新成功run”猜物料。
5. A5判定：受信条件评估器在唯一锁内读已批准策略和当前journal/live facts；全部条件成立，才生成本次exact派生writer approval并CAS注册pointer。沿用原`derive_writer_resume`严格消费和clear CAS。
6. A6：按批准的test-data scope执行真实六业务一次，保存owned run IDs和readback/stability证据。重复读取不重发业务写。
7. 任一不确定：停止新的前向写，保留原intent/evidence。显式readonly reconcile只判断原操作，不重放。恢复必须走独立批准的能力；没有安全恢复能力时诚实阻塞，不以“自主”解释为自动删数据或强制clear。

## 4. A5预批准条件策略：最小契约

已新增默认关闭的 `cn-conditional-writer-policy-v1` 纯验证器；小型 root 适配器仍待独立审查与 Router 接线。不能默默改变现有`cn-writer-resume-approval-v1`字段含义。策略审批的是生成一次exact A5能力的条件，不是批准无条件恢复writer。

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

执行事务（目标契约；当前源码的具体闭环见第 7 节）：

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

本表区分“源码修复”“本地独审”“真实系统验收”。本地提交不等于已推送、已合入或现场部署；未运行的边界继续保持 OPEN。

| ID | Severity | 问题与状态 | 修复提交 / 路径 | 验证证据 | 仍未测范围 / 关闭条件 |
| --- | --- | --- | --- | --- | --- |
| AUTO-01 | P1 | 静态批准不能等同未来条件授权。PARTIAL：纯策略已审；存储/固定适配器待审 | 本地 `0ceac126d`；`scripts/cn-release-conditional-writer-policy.py`；本地 `92bf99f87` 的 `conditional-writer-store.py` / `conditional-writer-adapter.py`（均在 scripts/cn-release- 前缀下） | 纯策略 18 项 PASS，独审 ACCEPT_LOCAL_ONLY；默认 disabled，独立 policy SHA、target/version/digests/code/evidence/TTL 门；返回未安装草案 | 独立人类策略批准及安装尚无；自动 Router 调用尚未写；root 实际文件安装、权限与云 A5 未验收 |
| AUTO-02 | P1 | 策略/发布哈希循环及互相自证。PARTIAL：代码采用单向引用 | `0ceac126d`：policy 固定 `releaseSha256`；adapter 草稿读取独立 root `by-release` pointer→policy SHA→原文；release code closure 只包含代码 hash，不包含 policy SHA | 18 项含无 approval、policy 篡改、缺独立 observation 拒绝；新 adapter 旧 release 缺新增 code pins 反例 PASS | 外部批准/安装者身份未现场验证；内部 fixture 参数不构成真实 root 信任锚；不得自行生成或安装 pointer |
| AUTO-03 | P1 | 漂移、重复消费、unknown 后重发。PARTIAL：本地存储已审，锁集成待审 | 本地 `92bf99f87` 的 store、adapter；后续 Router delta 尚未提交；`scripts/cn-release-terminal-delegation.py` 增加 owned-lock capability | 存储 10 项：真实双进程竞争、claim/批准文件/pointer 三处 `os._exit` 后不重发、terminal 失败/撤销/事实改变无 pointer；锁 4 项：真实 fork/thread、伪造/失效 capability、原 materializer 同锁 | 新 adapter 固定 store→entry 锁顺序和发布前复验待独审；仅进程崩溃，不是断电/文件系统故障实测；未验证真实 host hold 并发或 cloud clear CAS |
| AUTO-04 | P1 | runner 能写 root 批准/代码而自授授权。OPEN | adapter 草稿固定 `/etc/workspacex-cn/`、`/usr/local/lib/workspacex-cn/release-control`，私有 FD/完整 code closure 读回；不是权限部署 | 本地 symlink、mode、静态 pointer 不覆盖测试；公开默认 disabled；未执行真实 policy 安装 | self-hosted runner/sudoers/root ownership/目录 ACL 实际读回及低权限反例仍缺；不得以代码检查替代机器权限 |
| AUTO-05 | P1 | 旧 source/路径耦合与错误实际 receipt。PARTIAL | 本地 `e7e3769b6` 修 acquire consumer/delegation/observer/router 原 receipt 提升；`f9db09b2e` 补断点/冲突反例；模板 specialization 保留 | 本轮核提交与路径；原表只读局部 upgrade 检查继续有效；新 adapter 5 项使用实际 driver/Router admission与command/entry/materializer（provider 是 fixture） | 不宣称任意 source/路径/角色通用；完整生产安装路径和真实 promoted receipt 未验证；promoted receipt 新测试的独审结果由其 owner 记录，本文不冒认执行 |
| AUTO-06 | P1 | exit 假绿、skip/缺 suite/漂移 snapshot 与十轮误计。PARTIAL | `441bcf6d3` fixed/recovery driver 终态 exit 与故障证据；`c710982bb` simulation/workflow/domain；`e70b6e13b` CI exact root clone；runner 当前仍有未提交改动 | 精确问题账本见 simulation matrix；这些提交存在已核，但本文未独立关闭 SIM-01…05；正式同 final commit 十轮尚无结果 | required inventory、真实 Linux containment、完整故障矩阵/缺依赖门、同提交十轮最终证据仍需统一核实；不能把作者 PASS 或 workflow 文件当现场验收 |
| AUTO-07 | P1 | 全局 30 分钟在停写后耗尽。OPEN | policy/terminal 保留原 requestedAt/deadline；adapter 以实际 status.observedAt 评 freshness，不改为当前时间续租 | policy expiry/stale/future 反例 PASS；既有 1487 秒只是三段测量 | 停写前真实剩余预算、全链真实延迟、超时后远端 terminal/恢复仍无完整样本；不承诺 SLA、不暗增窗口 |
| AUTO-08 | P1 | held-health/fixture 被当真实业务或扩大数据外发。OPEN（证据边界已明确） | 原 A5 输出 `businessAcceptancePassed:false`；policy 固定 test-data-scope 原 hash；adapter receipt `writerResumed:false` | 实际 Router 离线接续至 `CHAIN_COMPLETED`，但 provider/live admission 仍 fixture；原 browser integration 仍手写 API/SSE/ASR/PDF | 真实 WorkspaceX 六业务、模型/ASR、用户/组织 scope、外发限制、TLS 与实际 owned run IDs 仍需授权后独立验收 |
| AUTO-09 | P1 | 备份误当可恢复、runtime rollback 误当数据恢复。OPEN | `cn-release-rds-backup.py` 原 receipt 明确 `isolatedRestoreTested:false`；本次未扩大恢复能力 | 现 backup provider fixture 仅证明请求/回执契约；升级测试仍有 UPG-01 局部覆盖限制 | 真实 current-epoch restore、迁移/启动失败恢复及 post-clear rehold/data 恢复未证明；须保持独立授权 |
| AUTO-10 | P1 | GitHub 取消不等于现场撤销。PARTIAL：本地 pointer 撤销门 | store/adapter 草稿发布前重读独立 policy pointer/raw，claim 保留；不覆盖原 writer pointer | store terminal 内撤销 policy 反例 PASS；只保证该本地模型不发布；adapter 从原 status 时间及同 entry 锁再核 | root 撤销与批准发布的统一安装锁协议、真实并发 revoke/clear、GitHub取消到现场的认证通路尚未实现；不得宣称任意外部 root 改文件都与本锁原子协调 |

### 本次测试与源码快照（2026-10-12）

固定解释器：`/Users/shenyanbin/.local/share/uv/python/cpython-3.12.14-macos-aarch64-none/bin/python3.12`，使用 `PYTHONDONTWRITEBYTECODE=1`。

- `unittest discover -s tests -p 'test_cn_release_conditional_writer*.py' -q`：33 PASS = policy 18 + storage 10 + adapter 5；无 skip。存储并发/崩溃使用真实本地进程与临时文件，不使用 mock history 替代这些故障。
- `test_cn_release_writer_lock.py`：4 PASS，包含真实 `fork`/`flock` 竞争及线程归属；`test_cn_release_terminal_delegation.py`：12 原有测试 PASS。总计 49 项，本地本轮代码验证，**不是正式十轮**。
- 最后 static wrapper 顺序修复后，12 + 4 + 5 再次 PASS；仍先校验原批准/时间/输入再持锁，避免无效请求提前触碰 attempt 状态。
- Adapter 的 5 项实际执行 driver、Router admission/command、entry journal、原 materializer。外部命令响应/live provider verifier 使用 `test_cn_release_full_chain` 的明确 fixture；固定 root loader/production 文件权限没有在 Mac 假装 root 实测。
- Store 独审曾 ACCEPT_OFFLINE_PRIMITIVE_ONLY；terminal owned-lock + fixed adapter 此 49 项快照已获独审 ACCEPT_LOCAL_INTEGRATION，并提交为本地 `92bf99f87`；随后新增自动 Router 接线、release claim 索引、Linux root fixture 修复另行待审。`git diff --check` PASS；尚无本轮集成 commit/PR/CI 结论。

| 文件 | 本次最后核对 SHA-256 |
| --- | --- |
| `scripts/cn-release-terminal-delegation.py` | `9270f08121509708c313dd27a1388e7893d1acb46105d2f05806c986649a84a1` |
| `scripts/cn-release-conditional-writer-adapter.py` | `0f8e98d74b7e696943a88a325ca6a551edadd6b22abd10b7e4df0b7d90162612` |
| `scripts/cn-release-conditional-writer-store.py` | `f7718d48a965fc02686ede4f46b9d476ddd516467f9199c9dabd951f9ab17b03` |

以上 hashes 只对应该轮测试快照；后续独审修复必须更新快照和重新验证，不沿用旧 PASS。并发 revocation/clear、remote mutation 终态、真实恢复和业务不能由这 49 项推导。

## 8. 仍需的权限和现场前置

- 精确release与潜在条件A5策略的人类审批；授权需明确副作用/testscope/TTL/一次性和恢复边界。已有静态approval能力不是本设计的新策略授权。
- root安装闭包/CAS、protected环境、专用runner、准确sudo入口、cgroup和完整SDK/browser工具库存；不读取或传播凭据内容。
- 精确GitHub artifacts读取、香港对象权限、生产ACR/Redis验证、RDS CreateBackup/Describe、实际CloudAssistant/host权限及其期限。不新增账号、凭据、角色权限或资源以“使流程自动”作为默认理由。
- 当前真实DevApp/生产服务身份、baseline、配置与稳定密钥continuity、磁盘和global预算、完整备份/restore能力、A6业务输入；只接受原始观测，不手填成功。
- 所有新付费隔离资源、真实模型/ASR/数据外发若超已批准范围必须先有具体范围授权。本文只设计，不消耗这些能力。

**当前方案状态：需要修改并验证；未证明全自动生产发布就绪。A5现有实现不依赖Chat协议；条件策略纯验证已提交，本地固定适配器待独审/自动路由接线，全链GitHub自主发布及生产条件授权均未验收/启用。**

### 后续接线增量（待独审，不覆盖上表 49 项快照）

Router 的 root release 可选字段 `conditionalWriterPolicy={"enabled":true}` 才启用条件路径；无字段或 false 保持旧行为。额外 adapter/store/policy code pins 必需。没有合法 policy 时继续 WAITING；现存静态批准在没有条件 claim 时优先。已经存在条件 claim 的 release 必须有完整 decision、原批准 pointer 和仍有效的原 policy；未知状态、换 policy、撤销或指针冲突不可 fallback 为 static。

新 `release-<releaseSHA>.json` 持久索引先于 policy claim 和 materializer，避免 pointer 发布后、decision 写前崩溃被当作静态批准；同一 release 换 policy 不能重置消费次数。新增测试包含实际进程 `os._exit` 的该崩溃点及实际 Router 接续，仍使用外部 provider fixture。代码冻结后由独审记录最终测试数与哈希，旧 49 项不自动覆盖新 delta。

Linux root CI 的 store fixture 改在 `/var/lib` 创建 mode 0700 临时目录（`tests/cn_release_private_fixture.py`），避免默认 `/tmp` 的 sticky ancestor 与真实生产门冲突；非 root 保留原临时目录。没有放宽生产目录安全检查；本机 Mac 通过不等于 Linux root 运行已验收。

### 已生成请求后的撤销检查修复（待独审）

源码发现 `fixed-driver` 在 `lookup` 找到既有 clear-hold package 时会跳过首次 admission，直接进入 `NOT_STARTED → advance`。这条具体分支已补：仅在 clear-hold 即将首次 advance 前再次调用 Router admission；`status/reconcile` 只读、UNCERTAIN 不重派、已完成 clear 不重复执行。它不会自动续期或签发 policy。

- `scripts/cn-release-fixed-driver.py` SHA `52da666243e085f327b274facccf8d77411af066b478641776acfe837b3b6d98`。
- Router SHA `d1e1f3879632584f1f8eeafede0fb253e352f7233aceaf27edcdf45dee3b0efc`；adapter SHA `7d06468b3620633e8c2b93accc2435803c227d5b09bc9476636ee1f3ff29f356`。
- `test_cn_release_conditional_writer_adapter.py` 当前 12/12 PASS（含实际 Router 已生成 package 后撤销→无 clear 调用/无第15阶段 intent，status/reconcile 仍 NOT_STARTED，以及 static 预生成 package 成功且再次运行不重 clear）；原 `test_cn_release_fixed_driver.py` 13/13 PASS。这里的 25 项为增量回归，不与旧 49 项简单相加，因为 adapter 有重复用例。
- 第三轮 GitHub CI `38236194304` 已实际暴露旧 sticky `/tmp` 导致 store 的 10 项及 adapter 的 2 项失败。证据目录：`release-continuation/simulation-evidence-20261012/github-38236194304`。新 `/var/lib` helper 针对该根因；下一次 Linux CI 未通过前，这些失败不标 reverified/closed。

该修复覆盖“生成后、下一次调用前已经撤销”的确定路径；真实 root 安装/撤销写者在 admission 到远端 clear CAS 期间的统一锁与线性化协议仍是现场边界，未由本地测试证明。没有声称 GitHub取消即时撤销已经在途的远端动作。
