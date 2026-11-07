# CN 发布隔离仿真覆盖矩阵

更新日期：2026-10-12。历史审计基线为 `8c5d4eac8dd9d44b9837fc38a0e754b54ddda6cc`；本次已完成 CI 对应 merge commit `c0ee7397a2b3b5a2e17a1a3791cb1542f5fb7887`（候选含 `e9100a7e9`），工作树 `github-autonomous-release`。
**最终同一提交十轮：0/10；生产未执行。** 四次已完成 GitHub 仿真均为不同提交的一轮诊断，不累计为最终轮次。第四次 CI `38237133763` 已通过现有 suite，但完整范围未覆盖，不能按 runtime-only 结案。此次仅更新本 Markdown，不改变机器矩阵、计划、代码或授权。

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
| recovery driver（D01 已修代码） | 当前 `run/reconcile` 仅 `RECOVERY_VERIFIED` 返回0，其他正常非终态2；异常1；`status` 成功读取0；`__main__` 使用 `sys.exit(main())` | 不再将非终态当成功；本表是当前源码核对，不能借普通 driver CLI 测试替代 recovery CLI 的精确复验 |
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

## 历史本地执行记录及可直接执行的测试

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
| D01 | 历史 recovery CLI 非终态返回0 | 当前已按 `RECOVERY_VERIFIED`/mode 区分0与2，并传播异常1 | 代码修复已核；精确 CLI 覆盖须看对应 case，不把整组通过等同该反例通过 |
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

## 真实 GitHub 诊断记录（按 run / commit 分开）

证据根目录为任务目录 `release-continuation/simulation-evidence-20261012/`。每个 `github-<run>/summary.json` 是原始汇总，`round-01/round.json` 是轮次及 suite 结果，`*.tests.cases.json`/`*.tests.inventory.json`/`*.log` 是用例清单与原输出；CSV/report 为派生视图。不得把 suite 数、主题数或不同提交的通过项相加为轮数。

| GitHub run / 精确 commit | 原始结果 | 本次真实结论 |
| --- | --- | --- |
| [38233060655](https://github.com/boardx/workspacex/actions/runs/38233060655) / `874d6ce568d7a0480370ecff4cc55f2442d74a55` | 1/1 诊断轮；762 pass、42 fail、1 skip；129.662秒；整轮 failed | 保留 entry/root 路径、依赖、归档等失败原文；不能把平台 skip 计绿。原件：`github-38233060655/summary.json`、`round-01/{release,hongkong,candidate,image-archive}.log` |
| [38235230946](https://github.com/boardx/workspacex/actions/runs/38235230946) / `50c6dc602a1f69dffbb9144b08fd2086ee5b2a59` | 1/1；828 pass、0 fail、0 skip；140.472秒；整轮仍 failed | 七组用例通过，但 `sourceUnchanged=false`，源码清洁门没有被绕过；不是完整通过轮。原件：`github-38235230946/summary.json`、`round-01/round.json` |
| [38236194304](https://github.com/boardx/workspacex/actions/runs/38236194304) / `dbd5f20c1684b894f1f37b295f6eab40c09efe06` | 1/1；857 pass、13 fail、0 skip；156.042秒；failed；机器矩阵 cases 53/53、requirements 21/32 | 八组含 Linux PostgreSQL；13失败来自 conditional-writer 测试私有父目录（11项）和浅克隆缺历史 Git 对象（2项）。另有 `scripts/__pycache__/cn_release_simulation_domain.cpython-312.pyc` 污染，sourceUnchanged=false。原件：`github-38236194304/summary.json`、`round-01/release.log`、`round-01/round.json` |
| [38237133763](https://github.com/boardx/workspacex/actions/runs/38237133763) / `c0ee7397a2b3b5a2e17a1a3791cb1542f5fb7887`（含候选 `e9100a7e9`） | 1/1；878 pass、0 fail、0 skip；160.123秒；passed；sourceUnchanged=true，轮前后均干净；53/53 case、21/32 requirement | 现有诊断轮通过；`accepted=false`、`fullMatrixCoverage=false`、`tenOfTen=false`。原件：`github-38237133763/summary.json`、`round-01/round.json`、`round-01/release.tests.cases.json`。不是最终十轮之一 |

上述时间只是隔离仿真 suite 用时；真实云端及生产层在四个 summary 中均为 `executed:false`。未测的吞吐、恢复耗时、磁盘峰值、安全违规数保持 null，不将 null 写成0。

## 缺陷闭环：代码、复验、缺口分别记录

历史 SIM-01..05 的发现保留如下，取消过期的“全部 fixed=false”总计。**代码修复与某个 CI 的反例通过不等于最终完整矩阵通过**；当前没有 `accepted=true` 的最终十轮结果。

| ID / 严重性 | 历史缺陷与当前代码 | 已有真实复验证据 | 状态 / 剩余门 |
| --- | --- | --- | --- |
| SIM-01 / P1 | 原 `wasSuccessful()` 允许 skip/expectedFailure。当前 `child()` 和 `execute()` 均要求零 skip、零 expectedFailure、非空测试，并逐 case 记结果 | 第三次 `round-01/release.tests.cases.json` 中 `SimulationTests.test_skip_and_expected_failure_cannot_report_green` 为 pass；首次42fail/1skip仍整体failed | CLOSED（本缺陷范围）；第四次指定反例 pass，最终提交十轮仍待验 |
| SIM-02 / P1 | 原不包含 untracked 的 dirty 检查漏掉动态发现文件。当前 `source_status` 包括所有 untracked，记录轮首尾状态；CI 从精确 SHA 建 root-owned 私有 clone，核 tree/父目录/清洁度 | 第三次 `test_ten_rounds_dirty_tree_is_rejected`、`test_source_status_is_bounded_redacted_and_never_excludes_cache` pass；原 `round.json` 实际发现 pycache 并拒绿 | CLOSED（本缺陷范围）；第四次相同反例 pass，轮前后 dirty=false、sourceUnchanged=true，bytecode 污染已在该提交复验消除；前三次失败保留 |
| SIM-03 / P1 | discover 曾绕过 Linux 文件 main 平台门。当前 child 对所有 `linux-*` 明确拒绝非 Linux；standalone 合同实际调用 main | 第三次 `test_linux_suite_requires_real_linux` pass；`round-01/linux-process.tests.cases.json` 与 `linux-domain.tests.cases.json` 已有 Linux pass | CLOSED（本缺陷范围）；第四次平台反例和 Linux suite pass；Mac 结果仍不替代 Linux |
| SIM-04 / P1 | 只 kill suite PGID 无法约束 setsid 后代。当前 `cn_release_simulation_domain.py` 管理私有 cgroup，spawn/close 要求可证明 cleanup，未能证明就失败 | 第三次 `round-01/linux-domain.log` / `.tests.cases.json` 的 `linux_domain_contract` pass；真实 leader-exit、timeout、嵌套 setsid、cleanup race 合同，另 `linux-process` pass | CLOSED（原4场景范围）；第四次真实 Linux 合同 pass；新增第5场景的问题另列 SIM-06，不用原4场景覆盖它，也不证明远端写已终止 |
| SIM-05 / P1 | 原 all 只有4组，遗漏覆盖。现8组：release、hongkong、candidate、image-archive、legacy-faults、linux-process、linux-domain、linux-postgres；机器矩阵逐 exact case/commit/run/round 核覆盖 | 第三次8组真实执行，53/53 case，但只21/32 requirement；`fullMatrixCoverage=false`。独立 Chromium及其他 requirement 不可借 suite 名称填绿 | 部分补齐，**仍 OPEN-COVERAGE**；需全部 required requirement 的同轮证据，不能放宽分母 |
| UPG-01 / P2 | `failure_isolation.actual_switch_branch` 仍为 AST 末段编译及 fixture，未证明完整生产 main 授权/锁/FD/真实 Docker rollback | 第三次 `round-01/release.tests.cases.json` 的 RuntimeFailures 通过仅证明声明边界 | OPEN-COVERAGE；真实完整入口恢复不由局部分支测试替代 |
| CI-01 / P1 | 第三次 conditional-writer 11项先被 `UNSAFE_PARENT` 挡住，未到目标反例；当前测试改用 `cn_release_private_fixture.private_temporary_directory` | 失败原文 `github-38236194304/round-01/release.log`；修复源码 `tests/test_cn_release_conditional_writer_{store,adapter}.py`，候选 `e9100a7e9` | CLOSED；第四次 `release.tests.cases.json` 中 conditional-writer store/adapter 对应11项全部 pass，已到达目标失败/竞争反例 |
| CI-02 / P1 | 两个历史回执反例用 `git show 8c5d...`，浅克隆无该对象。当前用入库原字节并验证原 SHA，未改原拒绝行为 | 失败同上 log；修复 `c0991a504`、`tests/fixtures/cn-promotion-recovery/acquire-observer-8c5d4eac.py` 与测试读取/hash断言 | CLOSED；第四次 `test_original_exact_base_rejects_actual_empty_receipt` 与 `test_original_exact_base_rejects_actual_partial_receipt` 均 pass；原失败不删除 |
| AUTH-01 / P1 | conditional writer authority 在生成后、真正 advance 前仍需重新检查撤销/漂移；`e9100a7e9` 增加实际 advance 前检查 | 第四次 `release.tests.cases.json`：`RouterTests.test_generated_package_revocation_blocks_before_advance`、`test_policy_replacement_cannot_reset_release_consumption`、`test_pointer_before_decision_crash_is_not_static_approval` 均 pass；对应真实 adapter/router 代码 | CLOSED；第四次实际候选反例已复验；已有请求仍必须最新 authority 检查 |

| SIM-06 / P1 | 新增第5个 cgroup 场景中，`tests/cn_release_simulation_domain_linux.py` 构造 entry 专用 `parent` 后又被普通 nested-domain 的 `parent` 无条件覆盖，目标路径未真实执行 | code_review 静审发现：`nested_case(legacy_entry=True)` 的 actual-entry parent 被覆盖，目标 entry 未实际运行；没有实际 Linux 失败回执或异常 code，不把预期断言失败写成已复现。作者已加 `else` 并做 AST 分支构造检查 | OPEN（代码已修、验证待完成）；仍需独审及实际 Linux entry 分支日志后再关，待新11-suite CI |

**量化账本：原9项中已关闭7项（SIM-01..04、CI-01、CI-02、AUTH-01），仍开放2项（SIM-05、UPG-01）；新增 SIM-06 一项开放。合计10项：closed=7、open=3；P1共9项（closed=7/open=2），P2共1项（open=1）。** 关闭只指该缺陷的代码与具体反例，不表示发布全范围完成。第四次原件位于 `github-38237133763/round-01/release.tests.cases.json`、`linux-domain.log`、`linux-process.tests.cases.json`；不能把运行器未知/null的 `seriousIssuesClosed` 擅自改成 true。

完整目标继续包含 **hotfix、无DB变化、有迁移的发布、隔离恢复与恢复后的验证**。普通 runtime-only 十七阶段和 PostgreSQL standalone 通过不足以结案。当前新增 PostgreSQL lifecycle 正在接真实 driver，新11-suite 尚待 CI；未执行的新范围不计已覆盖、不回填第四次的53/53与21/32。真实 PostgreSQL fixture 仍不等于上海 RDS 恢复或生产数据验收。D03..08 中未被新证据明确覆盖的真实应用、迁移、已 clear 后恢复及30分钟全云时延缺口继续有效。

## 可复用执行说明（不等于已调度）

先完成缺陷修复并取得候选的一轮完整诊断结果，再冻结同一提交。workflow 为 `.github/workflows/cn-release-simulation.yml`：Ubuntu 24.04、只 `contents:read`、无生产 environment/OIDC/云凭据，原结果保留7天。依赖在临时目录安装；CI wrapper 精确核对 `$GITHUB_SHA`，从本地 checkout 克隆 root-owned 隔离树；不修改生产或全局 Git 配置。

以下仅为待执行命令模板；`<FROZEN_REF>` 必须是审核后固定到唯一 final commit 的远端分支或 tag，调度后必须核对 run.headSha。**GitHub API 必须支持该 ref 上 workflow_dispatch，且调用账号已有相应权限。若 API 拒绝，不改跑其他 ref、不新增凭据或权限，也不能写“已启动”。** 本文未执行这条命令，最终十轮仍0/10。

```sh
gh workflow run cn-release-simulation.yml --repo boardx/workspacex   --ref '<FROZEN_REF>' -f rounds=10 -f seed=100
```

一次请求在一个固定 checkout 中顺序跑十轮；每轮必须运行冻结候选定义的完整 suites（第四次为8组；新11组待验证）、独立输出目录，seed 逐轮变化并保存在 `round.json`。若任何轮失败即停止后续轮，保存失败；改源码后新 commit 从1重新计。各组内仍有明确 fixture：外部 GitHub/OSS/ACR/ECS/RDS、full-chain 的 live verifier/preflight 与浏览器模拟服务，不升级成真实云验收。

验收读取 `summary.json` 的 commit、requested/completedRounds、各轮 sourceUnchanged/seed、所有 suite exit/cleanup、case counts、machine matrix coverage 和 acceptanceGates；还要看实际缺失项，不能只读 UI 绿色、`completedRounds` 或测试总数。`completedRounds=10` 也不自动证明所有门通过。当前报告对未独立证明的安全不变量、严重问题关闭和真实云30分钟保持 unknown/null，完整验收仍受这些门约束。
