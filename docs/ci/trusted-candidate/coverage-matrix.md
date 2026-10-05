# 可信最终候选：CI 覆盖矩阵与 suite 单一归属

基线：`d4f15668ace9883fc6ce3a20ab87032a18ec4a9d`，2026-10-05。

本矩阵以实际 workflow、package script、测试配置和执行器为依据。suite 的机器可读归属只有一处：[ci-suite-ownership.json](../../../.harness/config/ci-suite-ownership.json)。矩阵解释覆盖差异；配置负责 workflow/job、实际执行 step 名、产物匹配及保守的来源类别。

**第一阶段默认 shadow，所有现行检查与部署仍照常执行。** 单一归属是未来证据的逻辑归属，不是本次删除重复执行的授权。`eligibleSourceEvents` 只表示可参与可信比较的来源类型；它不是成功证明，也不授权跳过任务。未来启用 reuse 需要另行批准。

## 触发事实与判据

- `harness-verify`、`backend-gates`：`pull_request`、`merge_group`、`push(main/v*)`、手动。个人分支更新走 `pull_request synchronize`；这两份没有个人分支 push 双触发，不能删一个不存在的重复触发。
- `board-acceptance`：PR、main push、手动，**没有 `merge_group`**；六个自动 lane 由真实 diff scope 决定。
- `board-native-acceptance`：main push、手动，**没有 PR/merge_group**。既有独立批次与 exact-SHA 重验政策保持。
- 本文 PR 指普通 PR；MG 指 merge_group；M 指 main push；T 指 v* tag；D 指手动。`全`不是“所有注册在某 config 的 project”，而是实际选中 project 的依赖闭包。
- “同命令”仍须证明源码树、candidate base/head、workflow/测试定义、lock、工具链/运行环境及产物摘要一致。相同名字、相同命令文本或源码 SHA 不足以跨环境等价。
- source 必须来自同仓库受信 workflow 的 GitHub run/attempt/job/step/日志与产物。实际 checkout 在 install/执行 PR 代码前由固定 inline marker 记录，再由受信读取者验证。PR 自报 JSON 不是可信凭据。
- scope=false、空任务计划、跳过的 step、复用 verdict step、只上传一份文件，均不能证明本次实际执行。每个适用 suite 的实际执行步骤都必须完成并成功；矩阵分片须全数覆盖。

## harness-verify：普通 PR 与最终候选不是同一覆盖

| 逻辑 owner / job | 现行实际覆盖 | 触发 / 判决 | 重复关系与保留动作 |
|---|---|---|---|
| `verify-control-plane` | 生成物漂移、doctor、签核材料/契约、版本/元数据/规范单源、路由/跨层接线、测试与状态契约 lint、harness 自测；普通 PR 另有 base→head 状态迁移检查 | PR/MG/M/T；D 不执行。PR/MG 全仓 doctor 信息性，scoped doctor-soft 阻塞；M/T 全仓 doctor 阻塞 | 与 `verify:harness:raw` 部分重叠；PR 与 M 的 doctor 严重度和实时仓库状态不同。**保留、不可整 job 复用** |
| `verify-affected` | Turbo 受影响 typecheck/lint；真实 dry-run 计划后受影响 test；需要 web pixel tests 才安装对应浏览器；same-repo 排除 API，fork 由本 job 承担 API | PR/MG/M/T；D 不执行。受 event/base/head/fork 影响 | 是 full base 的子集；不同事件可能得到不同任务计划。空计划不是完整验证。**保留** |
| `verify-full-compile` | `pnpm turbo run build` + 全仓 typecheck/lint | PR/MG/M/T；D 不执行；阻塞 | 与 full base 的 typecheck/lint 重叠，但 full base 不显式跑全仓 build。当前无独立 suite artifact，**保留** |
| `merge-gate` | 独立 APPROVE、唯一 verdict label、Closes 与当前 PR/候选组集合 | PR/MG；阻塞、实时治理 | 不属于可缓存的树测试；**保留实时判断** |
| `fullstack-smoke` | sealed Docker runtime 内 `verify:fullstack-smoke`，raw 选择 `seeded-github-import` 的完整依赖闭包；另跑独立 trace geometry | PR/MG/M/T/D；当前 `continue-on-error: true` | browser raw 也在 full regression 执行，但 full regression 缺 geometry 且环境不同。未来只能按验证后的子 suite 比较，不能整 job 等价。shadow 来源 PR/MG |
| `full-regression-core` | `TURBO_FORCE=true verify:full` → 独立 base 与 browser 两个 lane：`verify:base:raw`（完整 harness lints、全仓 typecheck/lint/test）及 `verify:fullstack-smoke:raw` | **MG/M/T/D，不跑普通 PR**；D 要 `run_e2e_full=true`；失败不吞，后续 lane 仍执行 | full base 与 affected、API shard、control-plane 部分重叠；还有 API exclusive 等独有覆盖。**保留现行执行**；shadow 候选来源仅 MG |
| `chat-read` | `playwright.chat-read.config.ts --project=chat-read` 的完整白名单，含真实读写、Agent/Skill、附件、恢复/切换、HITL、键盘及已迁入的路径回归 | **MG/M/T/D，不跑普通 PR**；同 full 开关；阻塞 full aggregate | 和 smoke 或可选 chat-path 不等价。**保留**；shadow 候选来源仅 MG |
| `self-service-profile` | profile、profile/org keyboard、profile-org fidelity 四类 spec；独立隔离栈 | **MG/M/T/D，不跑普通 PR**；同 full 开关；阻塞 full aggregate | 不被 seeded smoke 替代。**保留**；shadow 候选来源仅 MG |
| `e2e-full` | 要求上述 core/chat-read/profile 全部 success | MG/M/T/D；缺失、跳过、取消、失败均不得绿 | 只汇总、不执行 suite；**保留稳定 verdict 名与依赖** |
| `chat-path-coverage` | config 独立 `chat-path-coverage` project，包括仍未迁入普通 chat-read 的路径 | 仅 D 显式开关 | 普通 chat-read 不能代表这些 opt-in 路径；**保留独立重验** |
| `chat-task-workbench` | config 独立 scorecard project，尚未实现能力的验收记分 | 仅 D 显式开关 | 是 scorecard，不能拿它的默认未执行解释为回归通过；**保留** |

两条容易误读的现行事实：

1. `run-verify-lanes.ts` 实际只执行 base 与 browser-smoke raw；**当前 `verify:full` 不调用 `verify:core-loop`**。fullstack config 中“full 也独立跑 core-loop”的历史注释不能当执行证据。core-loop 仍由 backend 的专属部署前门承担。
2. workflow 顶部“5 个非 core-loop spec”的历史描述已不能代表今天的实际闭包。`seeded-github-import` 依赖 seeded、Board collaboration、official digital human/role、realtime voice、image ingress 等 project，必须从 Playwright discovery 导出闭包；不能硬编码旧数量或只按文件名抽测。

## backend-gates：分片完整性、native 与部署前门

same-repo PR、MG、M/T/D 执行下表验证。fork PR 跳过这组需要其准入边界的 lane，由现行 affected/fork 规则处理；本改动不扩大 fork/token/secret 权限。

| owner / job | 实际覆盖 | 其他位置的关系 | 第一阶段动作 |
|---|---|---|---|
| `gates-fast` | API typecheck/lint；default API 分片发现为完整不相交并集；strict scoped doctor；契约单源、API 分层、edition capability | API compile 是 full-compile 子集；strict doctor 与 control-plane 不同 | 无独立 artifact且事件 scope 相关，保留 |
| `api-test-plan` | 从 `.harness/api-test-shards.json` 读取 shard 数与计划 | 是计划，不是测试 | 保留；不能当覆盖证据 |
| `gates-test` | 全部分片的 `vitest run --shard=i/n`；每 shard 自有 runner/Postgres、单 worker、锁定 Python 跨语言依赖 | full base 的 API `test` 包含同一 default discovery；**分片不包含** API `test` 后追加的 `vitest.exclusive.config.ts` | 无独立 artifact，保留；未来要全 shard 成功＋发现并集证明 |
| `native-document-chain` | 真实 AppArmor policy、隔离 document sandbox、user-code isolation、PG、native document locator/parse/cache revocation | `standard-document-locators-http.test.ts` 被 API default config 排除 | 保留真实环境；不能被 default API 全绿替代 |
| `native-runtime-lane` | 真实 AppArmor、sandbox session、`KERNEL_NATIVE_RUNTIME=1`、pins/session API 与 Python native skill activity | native-runtime test 被 API default config 排除；Python 全目录有行为重叠但不是同 sandbox/admission 环境 | 保留真实环境 |
| `gates-runtime` | shell RLS 反证、运行时双向/生产不可达断言、迁移强制重放与 schema 摘要 | API 单测/单次 migrate 不等于此验证 | 保留；无独立 artifact不可复用 |
| `e2e-core-loop` | `verify:core-loop` → seeded→reset→empty-db 三 project 核心闭环；真实隔离栈 | 不在 full regression 的实际选中链；不是 smoke 子集 | 保留部署前依赖；shadow 来源 PR/MG |
| `prototype-audit` | 专属截图审计 config，现行 ≥80 判据 | 不等于一般浏览器 smoke | 保留；shadow 来源 PR/MG |
| `design-loop-e2e` | 专属 responsive/prototype/share/html/parity projects，web fixture 环境 | 同名 design projects 在 fullstack config 注册，但不被 smoke 选中闭包执行；**注册不等于重复执行** | 保留；shadow 来源 PR/MG；缺 artifact仍回退 |
| `backend-required` | gates-fast/test、两 native、runtime、prototype/design 的适用结果汇总 | **e2e-core-loop 不在此 aggregate，仍是 deploy 前置** | 保留 check 名、全部依赖与 fork 语义 |
| `deploy` | 受信 root 部署入口＋迁移＋实际构建/重启/运行版本和 post-restart checks | 预合并验证不能证明目标运行体 | 每次现行适用部署继续执行；禁止预合并结果替代 |

API 独占持久化覆盖是具体的迁移阻塞项：`apps/api/package.json` 的 `test` 为 default Vitest **及** `vitest.exclusive.config.ts`。后者选中 `personal-transcription-persistence.test.ts`，default config 明确 exclude，backend 分片不覆盖它。删除 full base 的重复 API 执行前必须保留/迁移这段，不能只检查分片数量。

## Board：六道自动 lane 与 main 独立重验

`board-acceptance/scope` 用真实 base→HEAD diff，缺 base、无权读取或无效 diff 均失败。PR/M 的变更范围未必一致；source scope 必须证明 suite 实际适用并执行。六道自动 lane 均保留现行 PR/main 执行，只有完整实际执行的普通 PR 可参与 shadow；目前 MG 没有此 workflow 覆盖。

| owner / job | 实际 config/覆盖 | 边界 |
|---|---|---|
| `board-journeys` / `journeys` | `board-journey-acceptance.config.ts` → `board-final-acceptance.spec.ts` | Board 完整旅程，不能由若干 smoke 行为替代 |
| `board-security` / `security` | `board-security-acceptance.config.ts` | 隔离真实安全验收与证据验证 |
| `board-ui-functional` / `board-ui-functional` | visual/accessibility config；Chromium、Firefox、WebKit；额外类别/证据契约自测；`BOARD_OBSERVATION_MODE=functional` | 执行全部现行 UI 断言，**不含像素 capture** |
| `board-storage` / `storage` | durable images、maintenance、vendor schema migration | 图片持久化/维护/迁移，不是纯 UI suite |
| `board-import` / `import` | synthetic import report fullstack config | 只代表 synthetic report，不代表真实捕获供应商导出 |
| `board-api-ws-objectstore` / `api-ws-objectstore` | public API、AI API、shared outbox、portable real | `board-shared-outbox.spec.ts` 与 smoke 的 Board collaboration 闭包重叠；config/runtime和其他 spec 不同，不能整 suite 替代 |
| `board-visual-deferred` / `visual-deferred` | 同 visual config，但 `BOARD_OBSERVATION_MODE=all` | 仅 D 选择 visual-deferred；capture 与 functional 是不同环境输入，不能互称等价 |
| `board-import-captured` / `import-captured` | 真实捕获 Miro/Mural manifest | 仅 D 非 visual-deferred；保留现行 #4707 缺捕获源边界 |
| `board-performance` / `performance` | 专属 performance acceptance | 仅 D 非 visual-deferred；保留现行 #4704 边界 |
| `board-collaboration-50` / `collaboration-50` | 50-client、30-minute soak | 人类已延期自动 PR/main；仅 D 非 visual-deferred，不能重新宣称自动覆盖 |
| `board-heavy-batch` / `batch` | 冻结 admitted main SHA、first-parent commit/PR coverage、既有完整批次查证 | 只是批次计划；不能代替 native/meeting 实测 |
| `board-native` / `native-board` | 完整 connectors、ordinary files、sync lifecycle 三套 native config；固定 PG 16.15/pgvector 0.8.6 源摘要；完整 native receipts 对冻结源校验 | M/D，独立重验与 exact-SHA 现行政策保留。没有 PR/MG来源，第一阶段 retain |
| `board-meeting-room` / `meeting-room` | 真实 30-minute meeting-room config、独立隔离账本/证据 | M/D；smoke drawing preview/cancel 不代替长时 meeting，第一阶段 retain |

**基线实际缺口，不能标为已覆盖：** `d4f15668a` 未跟踪三份 native 必需 config：

- `apps/web/e2e/board-connector-existing-runtime.config.ts`
- `apps/web/e2e/board-files-completion.config.ts`
- `apps/web/e2e/board-peer-existing-runtime.config.ts`

它们虽被 native workflow 注册，执行器 `suitePresent` 对完整缺失写 `status: ABSENT, actualRuntimeExecution: false, requiredSuiteComplete: false` 后抛 `NATIVE_SUITE_ABSENT`；部分缺失也失败。归属配置用 `requiredCoveragePaths` 记录这三项，保持 native `eligibleSourceEvents=[]`。现有开放 PR #5245 修改 native workflow，应先与其负责人确认源码恢复是否属于该 PR；不属于时另行安排完整源码恢复。本次不补空 config、不把缺失当绿，也不改该 workflow。

## 保留部署、运行体与其他 workflow

DevApp 主部署仍由 `backend-gates/deploy` 串行进入。它要求 gates-fast/test/runtime、core-loop、两 native lane 全成功，现行 M/T（及既有受控 preview D）才部署，MG 不部署。

| 必须保留的层 | 当前实际入口/判据 | 是否可复用预合并证据 |
|---|---|---|
| 实际代码/构建/运行版本 | `deploy-gate.sh` 先核 root-owned 副本与仓库；`devapp-runtime-identity.mjs verify-source/build/publish-marker/attest` 绑定源、实际构建 bytes及重启后运行体 | 否 |
| 目标数据库迁移 | `deploy.sh` 对目标 migrate-cli，现行角色/权限兼容步骤；CI `gates-runtime` 另证可重放 | 否；目标执行仍需做 |
| 目标 sandbox/native/模型服务就绪 | 新 build 的 sandbox 实态自检、native API env/UDS/callback、deep-agent health/graph登记 | 否 |
| 重启稳定/API/web | 连续可信 API payload、稳定 web、active 服务，失败有界诊断 | 否 |
| 公网核心接线 | public realtime voice 匿名 Upgrade 必须401，私有 probe面公网不可达 | 否 |
| 登录/核心用户旅程 | **当前自动 core-loop 是部署前隔离栈，不能声称它验证了部署后的公网登录/完整核心旅程**；CN release 另有真实 browser acceptance；manual live evidence入口保留 | 预合并结果不能替代目标活体验证。后续需明确目标与实际 live assertions，不能用health替代 |

生产 CN 的准备、approval、activate/browser gate、compare-and-swap main-cn 和 verify-active 独立流程完整保留；已有 token 权限/环境 approval 不改变。以下其余现行 workflow 全部保留，未纳入本次 reuse eligibility；这防止核心矩阵被误读为全仓 CI 可删名单。

| 其他 workflow | 当前触发/责任 | 本次边界 |
|---|---|---|
| `deep-agent-tests` | path-scoped PR/main＋D；全目录 pytest，真PG/Golden证据 | 保留；API跨语言测试或单条native pytest不是全目录等价 |
| `skill-files-e2e` | PR/main＋D；真实多文件import/save/pin recovery、凭据边界和browser证据 | 保留；smoke的Skill lifecycle只是行为重叠 |
| `whiteboard-outbox-browser` | path-scoped PR/main＋D；native browser key/storage测试 | 保留；与Board API Outbox不等价 |
| `self-host-upgrade-drill` | path-scoped PR＋D；实际版本升级演练 | 保留；迁移单测不是完整升级 |
| `local-windows` | path-scoped PR＋D；Windows core stack及portable真实启动 | 保留；Ubuntu测试不能代替Windows产物 |
| `native-cwd-probe` | 自身path PR＋D；native cwd探针 | 保留；没有扩大为通用reuse |
| `dco` | main目标PR；提交DCO | 保留实时治理 |
| `home-gates`、`deploy-home` | path-scoped PR/main；home static/browser、实际部署 | 保留所有现行验证及部署 |
| `home-live` | 日计划＋D；公网活体检查 | 保留，不能缓存目标现在的状态 |
| `deploy-devportal` | path-scoped PR/main＋D；validate、部署 | 保留 |
| `deploy-coord-gateway` | path-scoped main＋D；部署及真实health | 保留 |
| `prepare-cn-release` | backend-gates完成事件＋D；冻结candidate、host prepared receipt | 保留既有准入逻辑，本次不dispatch |
| `promote-cn-production`、`deploy-cn-production` | 仅D；既有production环境approval、激活/live browser/CAS、verify-active | 保留，本次不批准/激活/部署 |
| `cn-release-tag-proof`、`mirror-minio-controlled-registry` | 仅D；tag不可变证明、既有镜像/attestation流程 | 保留权限与供应链边界 |
| `devapp-install-trusted-scripts`、`devapp-probe` | 仅D；受控安装或只读机器探针 | 保留，不借本次CI改动调用安装 |
| `devapp-sandbox-cjk-pdf-probe` | 仅D；正在运行sandbox产出真实中文PDF并独立验可读 | 保留活体产物验证 |
| `live-evidence`、`real-model-chat-evidence` | 仅D；实际模型/目标运行链路及产物证据 | 保留，不能被loopback模型覆盖宣称替代 |
| `s013-real-model-evidence`、`s016-asr-real-evidence` | 仅D main exact SHA；真实供应商/browser/ASR、脱敏证据 | 保留现行身份与密钥边界 |
| `office-editing-real-model-evidence` | 仅D；真实模型Office编辑、独立sandbox产物 | 保留 |

## 可执行漂移校验与反证

配置已覆盖核心四份 workflow 的**全部36个 job**，每个 `(workflow, job)` 只归属一次。plan/scope/aggregate/governance/deployment 明确列出，均不提供验证复用。13项具有现行实际步骤及artifact的同命令 lane 仅可参与shadow；其余 retain。集成的配置校验器应当把下列变化变成失败或保守 fallback，而不是静默继续：

| 校验对象 | 可执行判据 | 必须反证 |
|---|---|---|
| owner拓扑 | 解析YAML；四workflow当前job集合 = 配置owner集合；ID和owner无重复；每个owner确有job | 新增job未登记、删job、重复owner均红 |
| 实际执行step | 每个 `actualStepNames` 恰好一处run step；动态shard名按严格pattern解析完整1..n；plan/scope/reused verdict不能替代实际steps | 重命名step、执行step skipped、job成功但only verdict、缺任何shard都不合格 |
| 产物身份 | 从指定run/attempt获得GitHub artifact元数据及内容digest；配置pattern与实际upload name模板吻合；必须非expired且实际upload成功 | 只有JSON自报、别的run产物、缺失/过期/篡改摘要都回退 |
| 命令/定义 | 完整候选tree；workflow、package scripts、执行器、递归测试config/import/fixture、lock、runtime image政策与可信base一致 | 新提交、修改测试定义/脚本或lock/image，即使artifact叫同名也回退 |
| 发现与闭包 | 实际Turbo dry-run、Vitest discovery和Playwright `--list`的规范化集合（file+project+test identity+依赖）；不能用注册量替代执行量 | 0测试、漏exclusive、漏native、漏project dependency、仅子集grep/list均回退 |
| 事件与base/head | source实际PR merge checkout或MG base/head绑定；M候选tree及main父base一致；冲突/新base/新head必须新验证 | squash不同SHA既不能误判相同也不能只因不同SHA拒绝树比较；新main及冲突均回退 |
| 当前失败及读取错误 | 比较最新实际attempt时间；较新失败/取消/不完整不能倒找旧绿；pagination/权限/JSON/日志解析异常fail-closed | 旧绿+新失败、403、缺页、解析异常都执行完整验证 |
| 默认模式/手动重验 | absent/invalid mode → run full；shadow永不skip；fresh_run/原生GitHub rerun要求本次实际执行；required checks和deploy条件保持 | 拼错mode不跳；fresh_run不能选旧证据；删required/deploy needs须失败 |

静态核验能证明矩阵映射及保守准入，不能证明浏览器实际跑通或性能节省。发现集合需在有依赖的完整环境运行；目前本矩阵未产生新的完整发现运行回执。完整成功/负向路径由集成测试与PR CI记录，不能写“静态通过 = suite通过”。

## 覆盖迁移 backlog（先保留，再决定）

| 项 | 负责人 | 验收条件 | 下一动作 |
|---|---|---|---|
| A：归属/漂移单源 | 本次唯一集成owner＋coverage reviewer | 全36 job映射、执行step/artifact校验；默认shadow；所有旧检查执行 | 在本PR跑机械映射校验及独立review；不删除重复执行 |
| B：可信执行者/checkout证据 | evidence实现owner＋安全reviewer | GitHub权威run/attempt/job/日志绑定；pre-install固定marker；PR JSON伪造、权限异常及较新失败反证全过 | 本PR先产生/校验shadow receipts，交CI终态回执 |
| C：普通PR完整候选缺口 | CI owner＋测试owner | 采用MG已有core/chat/profile全覆盖，或后续明确迁移到受信最终候选；未适用PR不得提供假完整绿 | shadow记录三道source absence；另行批准改变候选执行归属 |
| D：full base与API重复 | backend测试owner | 完整default discovery分片并集、API exclusive持久化保留、两native配置保留、全仓非API测试及额外harness lints保留 | 先生成task/spec集合差分；分出不可删除覆盖，再设计未来单一执行器 |
| E：smoke/geometry环境差异 | fullstack运行时owner | 同raw浏览器闭包及runtime指纹；geometry有独立 owner和成功证据；full suite子lane失败不遮挡后续lane | shadow分别记录两种环境；后续只能按证明同等的子suite去重 |
| F：control-plane/affected事件差异 | harness owner | main global doctor、PR scoped doctor、transition、Turbobase/fork差异均保留；live governance不复用 | 先拆出tree-only与event/live检查的明确边界，保持本PRretain |
| G：Board自动lane候选缺口 | Board owner | 真实scope、全部六lane、三浏览器functional、synthetic/captured边界；MG覆盖未开启时不称最终组合已验 | shadow只接实际PR产物；未来有授权才决定MG接入 |
| H：Board native源缺失 | 既有PR #5245 owner＋独立测试reviewer | 三必需native config/spec/metadata完整入树；真实receipt为实际执行、零skip、正确源/统计；meeting完整 | 先同#5245确认源码恢复归属，避免双写；复核完整源与CI，缺失保持红/fallback |
| I：部署后登录/核心旅程 | release/runtime owner | 对本次实际部署版本的真实登录与核心流程运行证据，不能用隔离栈/health替代；CN现行live gate完整保留 | 先确认现行live入口与目标receipt；新增自动live门需单独设计，不借复用削弱它 |
| J：启用reuse审批 | 人类授权者＋唯一集成owner＋安全reviewer | 覆盖迁移完成；连续shadow source/target成功一致且反证无假绿；完整fallback与fresh入口；权限无需扩大 | 本次不启用；提交可审阅shadow结果与失败分类，之后再请求明确批准 |

## shadow与时间结论的边界

本阶段不跳过现有检查，所以已测CI省时为**0**；新增shadow读取/核验会有开销，必须在PR CI单独测量。初次修改workflow/证据定义的候选与可信base定义不同，应保守不可复用，这属于预期fallback，不能调宽规则把本PR造绿。后续稳定定义的实际source→main配对才可用来测比较准确性。

用户提供的发布样本 `run37302506067`：总24m35s，门控13m20s，部署11m14s。它只支持“未来该特定路径在完整可信复用后，可能省约13分钟门控”的估算；不是本PR实测收益，不能推出所有CI减半或整个PR耗时减半。部署11m14s及真实运行检查继续保留，缓存读取/校验和回退成本也须计入最终观测。

本分工本地回执：Python/PyYAML 对当前文件进行集合与名称核验，36/36 owner，无重复或漏项，实际 run step 唯一，全部 artifact regex 与 upload 模板匹配，定义路径存在且 retain/eligibility 约束通过；`git diff --check` 退出0。另对实际 `suitePresent` 调用 HEAD 的跟踪 e2e 文件集合，三份缺失 native config 全部返回 `false`。这些回执验证归属与缺口边界，不是完整 suite 或线上运行通过。
