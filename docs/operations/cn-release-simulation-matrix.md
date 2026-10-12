# CN 发布隔离仿真覆盖矩阵

审计日期：2026-10-12。基线 HEAD：`8c5d4eac8dd9d44b9837fc38a0e754b54ddda6cc`，工作树 `github-autonomous-release`。
本轮只修改本文件；审计时主端正在修改 fixed-driver、相应测试及香港传输 workflow，因此下面本地执行结果是**工作树快照证据，不是最终提交的十轮结果**。

## 范围和证据等级

依据根 `AGENTS.md`、`.agents/skills/workspacex-cn-release/SKILL.md`、其 release-sop，以及 `cn-release-entry/{README,fixed-driver,recovery-driver}.md`。本授权是隔离仿真；下表“允许写入”描述对应真实入口在其独立审批成立时的上限，**不授予本轮任何生产写、付费资源、发布或凭据读取权限**。

- **L（本地真实）**：真实文件、hash、归档、子进程、锁或浏览器；只证明明确列出的本地边界。
- **F（替身）**：provider、Docker/registry、数据库、live verifier 或应用响应由 fixture 替代。即使其外围代码真实运行，也不是生产全链证据。
- **P（平台特定）**：必须在隔离 Linux root/cgroup/renameat2 或实际 Chromium 上运行；Mac 跳过不算通过。
- **G（缺口）**：未实现、未运行，或测试没有覆盖实际依赖。

不可将源码中的 `test_real_*` 名称直接理解为真实云端。`test_cn_release_full_chain.py` 明确替换 `preflight`、`admission`、`run_command` 的外部执行和 `verify`；保留真实 driver/router/materializer/journal、synthetic ZIP/tar 的完整校验及本地进程。

## 当前真实入口与退出语义

`release-cn-fixed.yml`：仅 main 上的 `workflow_dispatch`，`production-cn-promotion` environment，专用 self-hosted Linux runner，生产 concurrency group、`cancel-in-progress:false`。参数是固定 mode 和 root-installed approval SHA，不允许传任意 shell/路径。workflow 只检查命令退出码，不另外解析 JSON 终态。

`cn-release-fixed-driver.py` 原顺序不可跳过：

```
consume → publication-stage → check-plan → publish → hold-stage → hold
→ stop-stage → stop → sessions → backup-stage → backup → rds-backup
→ switch-stage → switch → acceptance → clear-hold → observe
```

`acceptance` 是 held health/read-only status；业务六旅程在 A5 独立批准并实际 clear 后的 `observe`，不能把前者写成业务通过。

退出码分层（记录审计时源码，不用期望值替代实际值）：

| 入口 | 实际退出码/结果 | 调用方必须如何解释 |
| --- | --- | --- |
| normal fixed driver `run/reconcile` | `CHAIN_COMPLETED` 为 0；非终态为 2；异常为 1，`BLOCKED_OR_UNKNOWN` | 2 不是成功发布；保留具体 stage/status；0 仍带 `productionAcceptanceClaimedByDriver:false` |
| normal fixed driver `status` | 成功读取即 0，可为 `NOT_STARTED`/unknown/等待 | 只读命令成功不等于业务成功 |
| 原始 `cn-release-advance.py` | 成功返回对象为 0，异常为 1/`BLOCKED` | `status` 的0不可替代COMPLETED；normal driver做了额外终态判断 |
| recovery driver（审计发现的缺陷） | `main()` 对正常返回的等待/unknown/NOT_STARTED打印后返回None，脚本调用`main()`，因此0；异常才1 | **待修复**：workflow可能把未完成 recovery 判绿；不得按0认定恢复完成 |
| Python library 测试 | 成功返回/异常，不天然定义CLI退出码 | 必须另测实际CLI；coordinate单元测试不能证明workflow exit合同 |

## 场景准入覆盖

| 场景 | 当前实现/终态 | 允许写入上限 | receipt / retry / recovery | 覆盖及缺口 |
| --- | --- | --- | --- | --- |
| 普通无 schema 变更 | 已有17stage runtime-only lane；A5缺失停`WAITING_FOR_WRITER_APPROVAL`；完成`CHAIN_COMPLETED` | 经逐阶段批准的下载、发布、hold、stop、备份、runtime切换；A5后才恢复writer/业务写 | 原identity、attempt、requestedAt/deadline、前序rawSHA不变；未知不重发；恢复另审批 | full_chain L+F，非真实云；固定driver没有按classifier省略stage |
| hotfix，无迁移 | 与普通发布同门；urgency只是规划字段 | 不放宽写入、备份、时间或A5门 | 同上；不能借hotfix重置deadline | `test_cn_release_audit.py` classifier；不是独立已跑生产分支 |
| “无DB改动” | 没有pending SQL不表示无DB写；API启动仍可能清旧日志、seed、恢复worker | 仍需要当前epoch备份及启动副作用授权 | RDS receipt明确`isolatedRestoreTested:false`；镜像回滚不还原已删数据 | rds_backup L+F；真正零DB副作用没有证明 |
| prepared / artifact-ready / cold | classifier三种规划场景；固定driver目前仍相同17stage | 不能仅凭prepared标签跳过动态复验 | 未漂移的原proof可复用；不能重新计时 | audit覆盖分类，不覆盖全部独立执行优化分支 |
| additive migration | classifier增加backup/rehearsal/readback门；本fixed lane不是迁移执行器 | 本lane不得执行DDL或借runtime-only授权扩展 | 必须另有migration plan、隔离old/new兼容、迁移读回、数据恢复证据 | **G：17stage没有restore/migrate阶段**；仓库另有maintenance组件测试，不等于此链集成 |
| destructive/unknown migration、infra或stable secret变化 | classifier转maintenance | 需维护窗口独立scope，不由本矩阵授予 | 不可逆检查点与专属恢复；不得按普通镜像rollback宣称恢复DB | classifier F/真实Git diff；真实隔离恢复+迁移全链 G |
| config/seed-only、web-only、Pages | 与fixed runtime-only lane分开 | web-only只有实际证明不recreate backend才可讨论豁免；Pages不走该链 | 单独契约/验收 | G：不能用classifier或十轮model测试声称已有可执行分支 |

## 故障、写入、收据、重试和恢复矩阵

以下 exit 使用上节“normal”约定：异常1、可读非终态2、真正normal链终态0；具体library只抛异常时标明，不虚构其独立CLI码。

| ID / 故障 | 终态与写入边界 | exit / receipt | retry / recovery | 现有证据与未覆盖 |
| --- | --- | --- | --- | --- |
| T01 原ZIP/plan/set/proof缺失、错SHA、混attempt、过期 | 下载/校验失败；不发布canonical目录，不进入publish | library拒绝→normal1；无成功consume receipt | 不更新期望SHA来迎合下载内容；独立新proof不能延原deadline | acquire/revalidation/untrusted-cache tests：真实tar/hash L、provider F；HTTP故障需真实隔离端补 |
| T02 下载中断/短读/损坏 | 私有暂存可存在；未完整验证不可rename入正式inbox | 无成功receipt；UNKNOWN则保留intent | 精确原对象只读对账；重启不能换attempt掩盖未知 | untrusted_cache `download_corruption_never_publishes`；真实网络中断 G |
| T03 原子rename/NOREPLACE、已有target、symlink/FD替换 | 不覆盖既存target；只操作owned私有目录 | 错误无final receipt；旧目录/原字节保留 | 禁止覆盖式重试；冲突需核原所有权 | candidate_oss `download_full_no_replace`、untrusted_cache `linux_download_full_validation_and_noreplace`：P；Mac skip不计PASS |
| T04 磁盘不足、归档膨胀、跨阶段峰值 | GET前capacity门；保存/解压/后续publisher独立预算 | `SPOOL_CAPACITY`等拒绝，无后续成功receipt | 不降低门；只读核空间后另批准处理；容量观察不是排他预留 | acquire/host/formal-save预算tests；真实并发耗盘/ENOSPC及fsync掉电边界 G |
| T05 香港上传unknown ACK | 新cache/候选协议每key once PUT，未知仅GET全字节核对；完成标记最后 | 只有完整hash/size/身份通过才receipt | 不第二次PUT；不能用任意匹配缓存隐藏未派发异常 | untrusted_cache `unknown_dispatched_put_recovers_only_by_get` L+F；真实OSS失败注入 G |
| T06 旧hosted-release上传transient/拒权 | **另一入口**：transient最多4次push，2/4…退避；auth拒绝不重试 | exhaustion `REGISTRY_PUSH_FAILED`，无result；失ACK已commit读回可成功 | 先pull核exact image；foreign image停止；不能把此retry政策套给T05 | `test_release_failure_matrix.py` 9项L+F，本轮3.12全过；所有Docker/registry调用是fake |
| T07 ACR冲突、Redis鉴权/digest失败 | 首次candidate load/tag/push前拒绝；remote collision不覆盖 | 无published成功receipt；原tar不变 | 只清owned staging tag；未知push读回，无重复push | candidate_publication测试L归档+F registry/Redis；真实六digest云读回 G |
| T08 image inspect/store身份不一致 | 不能仅因Docker Id像manifest就绕过config/layer验证 | 原config/diffID/size/hash任一错即拒绝 | 不以legacylabel或伪descriptor接纳 | candidate_publication store tests真实归档L、Docker输出F；实际Docker不同store另需隔离实测 |
| T09 lost publish/action response | `EXECUTION_UNCERTAIN`后status `UNKNOWN_RECONCILE_REQUIRED`；不进下一stage | 原intent/action bytes保留；无假成功receipt | 显式reconcile仅observer；无需/不得第二次action | full_chain lost_publish；entry真实子进程+F远端效果 |
| T10 rename attempt/request绕过一次性 | active-attempt/identity链拒绝新名；不再派发 | `UNKNOWN`/BLOCKED，原失败intent保留 | 不重命名、不删账本；只有精确恢复seal才能放开后继 | entry `unknown_failed_write_cannot_be_retried_or_renamed` L；与T03文件rename区分 |
| T11 lock竞争/重复runner | driver、entry、canonical runtime各持其锁；第二执行者拒绝 | 锁失败1；completed重入不再次mutation | 不cancel运行者；status/原receipt核验；恢复seal释放entry锁后再进入原entry避免死锁 | entry/global flock、journal lock、recovery seal race L；GitHub两runner真竞争/runner丢失未跑 |
| T12 runner中止/timeout/setsid逃逸 | 禁止下一stage；本地终止域必须已空，远端操作仍unknown | process/intent保留；本地退出不能证明Docker/RDS完成 | 仅独立observer核远端；不自动重试/重建runner | entry真实进程L；`cn_release_cgroup_linux.py` P无skip；本轮Mac未跑，不代表云任务终止 |
| T13 permission/安装闭包/SDK缺失 | preflight在consume/stop前核完整后续能力；RDS必须两读API+exact写授权 | 缺失拒绝、无云写intent或成功receipt | 不创建凭据、不自动扩权；补独立审批/准确安装后重检 | rds_backup permission/SDK files、stage/router tests L+F；实际IAM/runner sudoers/SDKtarget本轮未验证 |
| T14 package生成中断/原收据部分写入 | `GENERATION_UNKNOWN_REPAIR_REQUIRED`或`EVIDENCE_CHANGED`/`TERMINAL_OBSERVATION_CHANGED` | 原始evidence不覆盖；无完成receipt | 不自动重生成不同请求；需要独立repair/recovery transaction | entry partial_evidence、router/materializer tests L；任意partial修复尚未实现 |
| T15 hold/stop/session-zero失败 | 已hold则保留；停服unknown不进入backup/switch | normal1/unknown；stop/session evidence不能伪造 | 读回exact运行体/DB sessions；恢复另审批 | full_chain stop timeout L+F，runtime materialization L；真实活跃连接排空/容器失败 G |
| T16 host backup失败/损坏 | 原hold保留，不switch；完整backup-result、manifest、config、tar都需验证 | 缺件/改tar无有效backup receipt | 不因cgroup空就证明远端备份完成；恢复读原exact backup | recovery_admission真实完整tar L、host/runtime状态F；生产大小/磁盘IO/恢复实测 G |
| T17 RDS CreateBackup ACK丢失/pending/failed/错job | once CreateBackup；只有原job映射Finished BackupId才完成 | pending到deadline拒绝；保持intent/provider原回执；`isolatedRestoreTested:false` | 只DescribeBackupTasks/Backups分页对账，无第二CreateBackup | rds_backup+full_chain lost RDS response L+F；不是实际RDS或restore通过 |
| T18 backup恢复/old-new读写兼容失败 | fixed17stage没有实际restore；不得推进迁移链 | **G，无本链实际receipt/exit合同** | 需隔离目标实际恢复验证及单独fail/cleanup设计 | legacy maintenance测试不能自动填此行绿；不得用备份存在代替可恢复 |
| T19 migration SQL失败/半迁移/ledger漂移 | runtime-only拒迁移scope，不能进入本链执行DDL | **G：真实migration partial失败/恢复未在本链执行** | 单独maintenance plan，不能自动重复不可逆SQL或宣称镜像回滚还原数据 | classifier检查DB敏感diff；专属migration组件另测，不是全链 |
| T20 API启动/seed/worker恢复失败 | switch不成为通过；可能已产生DB副作用，hold/状态需实际读回 | 无accepted业务receipt；switch未知保留原intent | held状态才允许准确runtime baseline恢复；数据恢复不在此自动路径 | runtime-stage/binder tests主要生成+F状态；真实启动失败及真实DB副作用 G |
| T21 A5缺失/错generation/过期 | `WAITING_FOR_WRITER_APPROVAL`或拒绝；无clear intent | normal run2；不产生业务成功 | 独立批准绑定switch/held-health/user授权/testscope；不延original clock | full_chain A5 pause/resume、wrong generation、deadline L+F；真实授权读回仍需现场 |
| T22 六业务失败/ASR/PDF/模型/权限失败 | A6失败，保留owned run IDs与原证据；writer可能已恢复 | normal1/unknown；不能以held-health或HTTP200代替 | 不自动重跑业务写；post-clear恢复需额外rehold/stop authority | business runner/observer契约测试；真实Chromium本地TLS fixture并非真实WorkspaceX服务/外部模型；生产业务 G |
| T23 恢复baseline与恢复后业务失败 | runtime→独立baseline writer approval→business→readback→seal | library `RECOVERY_VERIFIED`才完整；CLI非终态0缺陷见D01 | 每步once；unknown只读reconcile；未clear不能业务；新恢复窗口不改原release clock | recovery_driver真实files/subprocess L、ops F；baseline clear/readback F，真实生产恢复 G |
| T24 已clear后的故障 | 不能套held-only rollback；当前明确block | 无自动成功恢复receipt | 必须单独review rehold/stop scope和当前业务写影响；不可恢复已删除数据的声明 | recovery_admission `clear_intent_requires_new_rehold_approval`；完整post-clear恢复 G |
| T25 deadline / receipt最后验证耗尽 | verification结束后过期不产生normal完成receipt；A5等待不重置时间 | normal1或等待2；历史原clock保留 | 显式readonly reconcile可在过期后；正常action不得续租 | entry late verifier、full_chain A5 clock、recovery fresh approval L+F |

## 本轮实际执行记录及可直接执行的测试

本轮没有cloud/Docker/付费操作，也没有真实生产验收。父端负责完整 `test_cn_release_*.py` 基线，本文不重复运行该全集。

1. 默认Mac Python3.9运行以下8模块：**126 tests，119通过、7错误，exit1**。7错误全部来自legacy failure matrix调用`tarfile.extractall(filter='data')`；该解释器不支持参数，不能记录为业务缺陷或全绿。
2. 使用已存在固定Python3.12.14重跑`test_release_failure_matrix`：**9/9 PASS，exit0**，确认上述是解释器兼容问题。其他模块没有第二次执行；两次结果不伪合并为“最终commit126全过”。

```sh
# 固定现有解释器；无安装、网络、凭据或provider调用。
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH=tests
PY=/Users/shenyanbin/.local/share/uv/python/cpython-3.12.14-macos-aarch64-none/bin/python3.12
"$PY" -m unittest test_cn_release_entry test_cn_release_fixed_driver \
  test_cn_release_full_chain test_release_failure_matrix \
  test_cn_release_rds_backup test_cn_release_recovery_driver \
  test_cn_release_recovery_admission test_cn_release_recovery_writer -q
```

上述模块都先读过测试边界。更多可直接在同隔离本地执行的现有模块：`test_cn_release_audit`、`test_cn_candidate_publication`、`test_cn_candidate_untrusted_cache`、`test_cn_candidate_oss`、`test_cn_release_stage_contract`、`test_cn_release_runtime_stage`、`test_cn_release_business_state`、`test_cn_release_business_observer`。它们**本轮未由此审计执行**，不能填PASS。

平台专项：

- `.github/workflows/archive-bridge-tests.yml` 已声明Python release全套、Linux cgroup专项和isolated-business-browser。声明存在不是当前final head跑过的证据。
- `sudo -n /usr/bin/python3 -I -B tests/cn_release_cgroup_linux.py` 仅在独占、一次性Linux CI cgroup子树执行；不支持应非0，不把skip算通过。本轮未运行。
- `test_cn_candidate_oss.py`及`test_cn_candidate_untrusted_cache.py`的Linux NOREPLACE项在Mac明确skip，本轮不以Mac代Linux。
- `tests/cn-release-business-browser.integration.ts` 用实际Chromium、临时TLS服务，但HTML/API、run SSE、ASR和PDF均为手写fixture；适配器还设置`ignoreHTTPSErrors:true`。证明浏览器交互/runner契约，不证明真实应用、真实模型、真实ASR、PDF内容或证书链。必须另外执行真实隔离WorkspaceX栈，且禁止把fixture证据升级为生产。

## 明确缺陷与实施缺口

| 编号 | 发现 | 最小修复/验收要求 | 状态 |
| --- | --- | --- | --- |
| D01 | recovery CLI对等待/unknown正常return导致exit0，workflow只看退出码 | 按mode定义完整成功状态；run未完成非0，status/readback语义分别明确；新增真正CLI子进程+workflow反例，不只coordinate测试 | 已报主端；审计不修改源码，待最终diff复核 |
| D02 | Python3.9缺tarfile extraction filter | 测试/CI固定兼容解释器；不得删除安全filter换取绿 | 已用3.12.14确认9项PASS |
| D03 | classifier被误当normal/hotfix/migration执行分支风险 | 报告lane实际能力；migration/Pages/web-only另建明确契约，或明确拒绝 | 现文档明确，不能据十轮fixture宣称补齐 |
| D04 | 17stage的provider/live verifier和六业务服务器fixture替代关键真实系统 | 在独立隔离栈接实际Docker/DB/应用/模型；保留fixture定位边界 | 未完成真实全链验收 |
| D05 | partial evidence已有保留/拒绝，但任意partial修复没有实现 | 故障注入后保留失败；独立修复事务/恢复审批，不覆盖账本 | 已有拒绝测试，恢复能力缺口保留 |
| D06 | 已clear后的rehold/stop/data rollback不属于held-only恢复 | 单独契约+授权+故障恢复实测；不能只补状态布尔 | 明确未实现/未验收 |
| D07 | 30分钟全链未实测；既有build+HK+Shanghai段已24m47s | 十轮同时记录真实lead time和各阶段时间；模拟耗时不冒充实际SLA | 缺完整真实时延样本 |
| D08 | 测试中取消root/cgroup/真实permission、真实provider配置 | exact最终Linux入口验证全部安装/pin/权限，再跑真实隔离目标 | 本地test seam不能替代此门 |

## 全面仿真与最终十轮的顺序

1. **先做全面仿真发现并修复**：覆盖本矩阵所有适用故障；无法安全运行的真实边界必须写G及原因，不以模型代替。原“十个主题”只是coverage维度，不能当作十轮。
2. 冻结最终提交、全部测试/runner/container/runtime版本、输入原始hash、suite manifest与预期测试数。共享dirty工作树结果不计正式轮次。
3. 对**同一个final commit**执行**十轮完整自动回归**；每轮跑同一套全部适用tests与故障矩阵，独立临时目录/数据库/namespace；任何一轮失败保留原stdout/stderr（脱敏）、exit、receipts、cleanup结果和输入hash。
4. 修改任何代码/fixture/门禁后形成新candidate，**重新从第1轮计十轮**；保留旧失败，不只重跑失败test，不把不同commit的绿拼接。
5. 每轮报告：`candidateSha`、suite/runtime pins、round1..10、UTC起止、每项证据等级、pass/fail/skip数、exit、cleanup、原始artifact SHA、剩余G。无执行不得填PASS；skip不得充作真实平台验证。
6. 只有明确真实隔离栈执行完成的项可提升L/P范围；十轮fixture通过仍只证明十轮fixture。生产发布仍需独立审批、现场版本/权限/备份恢复/业务证据；本矩阵不触发生产。

## 独立审查问题账本（runner 草稿，未冻结）

本表记录源码审查证据，**不把静态可推导路径写成已经动态复现**。`reproduced=false` 表示独审没有运行该反例，不表示问题不存在；`fixed` 只有精确冻结修复已确认才为 true；`reverified` 必须有独立执行证据，作者测试不自动替代。优先级 P1 为阻止完整十轮验收的问题；P2 为覆盖/证据范围限制。

2026-10-12 本次更新只读看到作者修改中的 runner SHA `89c8a5301767f2a6fefa1536c927700ef82402e4c4be0eebc2a5cb7e13ee48d2`、workflow SHA `e3e9c6fb513361bfe24616f647d25afdef57bb7036f34cf166c80a5275eb25b1`。这不是完整候选冻结，也不是下面问题的关闭证明。原审查旧版未记录完整文件SHA，因此用明确函数/语句与既有源文件定位，不伪造旧hash。后续作者可能继续写入；独审须重新核最终字节。

| ID | Severity | 问题/证据 | reproduced | fixed | reverified | 当前状态 / 关闭门 |
| --- | --- | --- | --- | --- | --- | --- |
| SIM-01 | P1 | 原 `scripts/cn-release-simulation.py` 的 `child()` 使用`wasSuccessful()`，`execute()` passed未检查skipped/expectedFailures；unittest允许这两种结果整体successful，故可把缺依赖/平台skip计为绿 | false（源码确认；未运行skip反例） | false | false | OPEN / 作者修复中；现源码已见两处零skip/零expectedFailure门，尚待冻结及独立skip、expectedFailure、缺依赖反例 |
| SIM-02 | P1 | 原十轮前后`git status --untracked-files=no`，而`loader.discover`读取工作树通配文件；untracked测试可参与执行但不在声明commit且不触发dirty | false（源码确认；未动态增删测试） | false | false | OPEN / 作者修复中；现已见`--untracked-files=all`，需最终反例及固定测试inventory/snapshot证明；只检查轮首尾不能声称期间源码绝对不可变 |
| SIM-03 | P1 | `linux-process`通过discover导入`tests/cn_hk_performance_linux.py`，绕过该文件`__main__`的Linux_REQUIRED；Mac `/proc`不存在的assert分支可能误算已停止 | false（源码确认；未在Mac跑该suite） | false | false | OPEN / 作者修复中；现child显式platform门已见，需实际非Linux拒绝且Linux运行的最终证据 |
| SIM-04 | P1 | `execute()`只对suite.pid进程组SIGKILL；被测`.harness/scripts/vm/cn-release-advance.py`会创建独立session，suite超时/log-limit时该action可不属suite PGID。现runner timeout测试只有单sleep leader | false（跨源码控制流确认；未创建逃逸进程） | false | false | OPEN；需独占隔离Linux终止域或等价准确后代管理，真实suite→setsid descendant反例、超时后停止读回，不能按进程名全机kill |
| SIM-05 | P1 | `SUITES`只有release/hongkong/candidate/linux-process四个Python组；不含`tests/cn_release_cgroup_linux.py`、`cn-release-business-browser.integration.ts`、`test_release_failure_matrix.py`，所以`--suite all --rounds 10`不是本矩阵完整回归 | false（文件/配置静态集合比较；不需假称动态复现） | false | false | OPEN；作者已加入`simulationAcceptance`阻塞说明，但说明不等于补齐执行；必须冻结完整required suite manifest、实际平台依赖与每轮无缺项证据 |
| UPG-01 | P2 | `tests/test_cn_release_failure_isolation.py::actual_switch_branch`从生产main AST只编译末段，注入private/run/hold、固定`mode='switch'`；未执行main前置授权/锁/FD，也没有同分支rollback正例 | false（明确覆盖限制，非宣称运行缺陷） | false | false | OPEN-COVERAGE；补完整入口/rollback反例或持续明确“局部分支覆盖”，不可把其通过称完整升级恢复验收 |

量化状态：**6 项，P1=5、P2=1；独立动态 reproduced=0、fixed=0、reverified=0、closed=0**。这不是说全部问题都未经分析：SIM-01/02/03/05可直接由源码/文件集合确认；SIM-04为具体可达控制流风险，动态回归待执行；UPG-01是证据范围说明。作者修复方向已看到3项（SIM-01/02/03），但不提前关单。

升级代码局部审读结论：`upgrade-draft.py` 新增exact-five、service集合、唯一container ID、CN名称/project、非restarting及exact image检查未发现新增阻断。其当前原始字节SHA `baaa95ad3690277fd33c711f71a6945148682d28e5fac3007bc784adf41a2cd1`、长度16042，与`provenance.json`一致；历史originalSHA/15513字节仍保留。`failure_isolation`测试文件SHA `6a4e6f995be38c399858510ec172189f60ab3d16396b465093060d2671ff3035`。这仅是源码/哈希核验，**本次独审没有重复运行作者的测试或声称生产可执行**。
