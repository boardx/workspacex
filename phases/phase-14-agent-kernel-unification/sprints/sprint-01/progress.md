# 进度日志 — Sprint 14/01

## 当前已验证状态(唯一真相)
- 仓库根目录: `/home/user/workspacex`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F13（错误分类修复，issue #2718）——实现完成，
  `in_progress`，未能在本会话跑通 harness verify（环境 blocker，见下）。F01 的 PR
  #2729 已合入 main，但同一条环境 blocker 使其 status 也仍停在 `in_progress`。F15
  （完整可审计 transcript 存储改造，issue #2723）同样实现完成、同一条环境 blocker
  未能本会话跑通 verify，见下方 2026-09-04 22:xx 记录。
- 当前 blocker: 本会话沙箱 Docker 出网被组织出网策略拦截（`pgvector/pgvector:pg16`
  拉取对 `production.cloudfront.docker.com` 返回 403），`apps/api` vitest 全局 setup
  强制要求真 Postgres，本会话因此无法跑通任何一条 `pnpm --filter api exec vitest run`
  命令。详见 `session-handoff.md`。
- F01（apps/api 退化为薄网关）：已合入 main（#2729），status 仍是 `in_progress`
  （其 verify 未在合入前的会话里跑通，见下方各会话记录）。
- F03（网关 WebSocket 事件端点）：F03 会话实现完成，三条 verification 命令该会话
  真实跑绿（证据 `evidence/F03.verify.log`），细节见下。`pnpm harness verify
  --sprint 14/01 --feature F03` 的 feature 级三条命令跑绿后，进入它自己的整 monorepo
  "base verify" 门（`turbo run typecheck lint`/`test`），规模超出该会话时间预算，
  主动终止——不是观察到失败。status 因此仍是 `in_progress`，未手改，详见
  `session-handoff.md`。
- F13（错误分类修复，issue #2718）：F13 会话实现完成，同样撞上下方记录的 Docker
  出网 blocker 未能跑通 harness verify，status 仍是 `in_progress`。
- F03 会话解决了 F01/F13 记录的环境 blocker：沙箱没有可用的 Docker/组织出网策略拦截
  `pgvector/pgvector:pg16` 拉取——F03 会话改用**本机 apt 安装的 PostgreSQL 16**
  （`postgresql-16`/`postgresql-16-pgvector`）替代 docker-compose 起的 Postgres，
  外加一个仅存在于该会话 PATH 里的 `docker` 命令 shim（把 `tests/support/db.ts`/
  `auth.ts` 里 `docker compose exec postgres pg_isready`/`up -d postgres` 等固定几条
  子命令翻译成对本机 Postgres 的直接调用），使 `pnpm --filter api exec vitest run`
  可以真正跑通，不必修改任何测试基建源码。**这个 shim 只存在于该会话临时目录，
  不是仓库的一部分**——下一个会话若同样缺 Docker，需要重新搭一次（步骤：
  `apt-get install postgresql-16-pgvector` → 把 main 集群端口改到 55432 并起
  服务 → 建 `workspacex` 库 + `CREATE EXTENSION vector` → 跑一次
  `migrate(migrationConfig())` 让 `0001-kernel-roles.sql` 建好 `app_rw` 等角色 →
  PATH 前置一个把 `docker compose exec/up` 转译成本机命令的 shim 脚本）。F13 那轮
  会话没有这个 shim，仍撞在原始 Docker 出网 blocker 上（`pgvector/pgvector:pg16`
  拉取对 `production.cloudfront.docker.com` 返回 403）。

## 会话记录
### 2026-09-04 20:22:49
- 本轮目标: 实现 Phase 14 F01（apps/api 退化为薄网关：转发 run 到内核、旁路写账本、
  删除自有执行分支）。
- 已完成: 删除 `useLazySkillLoading` 伪循环与纯 complete()/completeStream() 分支，
  模型调用收敛为唯一一处 `invokeKernel(...)`；新增下发前健康检查
  （`checkKernelHealth` + `KERNEL_UNAVAILABLE` 终态码，含契约枚举与 DB 迁移）；
  execute-run.ts 1493 → 1364 行；新增两条 issue #2708 指定的 verification 测试文件。
- 运行过的验证:
  - `pnpm exec tsc --noEmit -p apps/api`（过滤已知 baseline 噪音 `fabric-markdown`）：0 新增错误。
  - `pnpm harness verify --sprint 14/01 --feature F01`：跑过，在 vitest 全局 DB setup
    阶段因 Docker 出网被拦而失败（非本次改动引入的逻辑缺陷，见下）。
  - 用 `tsx` 直接执行等价断言（绕开 vitest 全局 setup，纯内存 fake，无需真库）：
    四类场景（正常转发、KERNEL_UNAVAILABLE 快速失败、非 deep-agent provider 不受
    门控、completeStream 回退）全部通过，作为实现信心的补充说明（不是 harness 认可
    的证据）。
- 已记录证据: `evidence/F01.verify.log`（真实失败日志，未手改）。
- 提交记录: 见分支 `worker/remote-f01-14-f01` 的 PR（关联 issue #2708）。
- 已知风险或未解决问题: F01 尚未 `passing`——需要一个 Docker 出网可用的环境重跑
  `pnpm harness verify --sprint 14/01 --feature F01`。
- 下一步最佳动作: 在能跑 docker 的环境重跑 verify 把 F01 转 passing；之后按
  R11(b) 排 F02。

### 2026-09-04（F03 会话）
- 本轮目标: 实现 Phase 14 F03（网关 WebSocket 事件端点：真流式转发内核事件、落库与
  推流解耦）。
- 已完成: 见上方"当前已验证状态"与 `session-handoff.md` 的完整改动清单——契约层
  `aguiEventTypeFor` 对齐 AG-UI 原生事件类型，`RunEventBusPort`/`InMemoryRunEventBus`/
  `WS /agent-runs/:runId/events` 网关，`execute-run.ts`/`writeback.ts` 六类事件在
  真实执行路径上的发布点，`ModelCallProgressEvent` 补完整（非截断）字段。
- 环境: 本会话**解决**了 F01 记录的 Docker blocker（本机 apt 装 Postgres 16 +
  pgvector，PATH shim 转译 `docker compose` 调用），使 `pnpm --filter api exec vitest
  run` 首次在这一系列会话里真正跑通。
- 运行过的验证:
  - 三条 issue 指定的 verification 命令：真实跑绿，见 `evidence/F03.verify.log`。
  - `pnpm exec tsc --noEmit -p apps/api`、`-p packages/contracts`：0 新增错误。
  - 针对性回归批（21 个既有文件，约 156 条用例，含真实 Postgres 的 HITL/writeback/
    streaming 全流程）：全绿。
  - `packages/contracts` 全量 `vitest run`（26 文件/429 用例）：全绿。
  - `pnpm --filter api exec vitest run`（不设 `-t` 过滤，跑到超时前约 110+ 个文件）：
    零失败，覆盖 auth/chat/canvas/capability/skill/kernel/research/asset/plan-control
    等一大片不相关子系统，作为"没有引入新的失败"的补充证据（未跑满全部 793 个文件，
    单进程串行跑完整套件的时间超出本会话预算）。
  - `pnpm harness verify --sprint 14/01 --feature F03`：F03 自己的三条 verification
    先跑绿，随后进入它自带的整 monorepo "base verify"门（`turbo run typecheck lint`/
    `test`），本会话主动终止（规模超出时间预算，不是观察到失败）。
- 已记录证据: `evidence/F03.verify.log`（三条命令的真实通过日志）。
- 已知风险或未解决问题: F03 尚未 `passing`——需要一个能跑完整 monorepo `pnpm harness
  verify --sprint 14/01` 的会话/CI；`agui-bridge.ts` 自己的轮询循环本轮未切换（诚实
  范围收窄，见 session-handoff.md）。
- 下一步最佳动作: 见 `session-handoff.md`"下一步最佳动作"。
### 2026-09-04 21:39:27
- 本轮目标: 实现 Phase 14 F13（错误分类修复：`toFailure` 精确归类，取消
  `SANDBOX_UNAVAILABLE` 兜底误标，issue #2718）。
- 已完成: `run-skill-script.ts` 的 `toFailure` 新增 `ModelCallError` 分支（归
  `MODEL_CALL_FAILED`）；真兜底从 `SANDBOX_UNAVAILABLE` 改为 `UNKNOWN_EXECUTION_ERROR`
  （R7）；新增 `tests/agent-run/failure-classification.test.ts`（issue 指定的唯一
  verification 命令），含 E1 回归、CP 反证、兜底诚实、不回归四组断言。
- 运行过的验证:
  - `pnpm exec tsc --noEmit -p apps/api`：0 新增错误。
  - `pnpm harness verify --sprint 14/01 --feature F13`：跑过，在 vitest 全局 DB setup
    阶段因 Docker 出网被拦而失败（与 F01 那轮同一条环境 blocker，非本次改动引入的
    逻辑缺陷）。
  - 用临时 vitest config（只去掉 globalSetup）直接跑
    `failure-classification.test.ts` + 既有 `chat-skill-script-execution.test.ts`：
    共 15 个测试全绿；把本次改动 `git stash` 后重跑，新测试的前两条断言确实变红
    （证明测试抓得住真实回归，不是空转）。
- 已记录证据: `evidence/F13.verify.log`（真实失败日志，未手改）。
- 提交记录: 见分支 `worker/remote-f13-14-f13-error-classification` 的 PR（关联
  issue #2718）。
- 已知风险或未解决问题: F13 尚未 `passing`——需要一个 Docker 出网可用的环境重跑
  `pnpm harness verify --sprint 14/01 --feature F13`（F01 同样待补跑）。
- 下一步最佳动作: 在能跑 docker 的环境依次重跑 F01、F13 的 verify；F13 之后
  F14/F15（错误人性化转换层、transcript 存储改造）可并行开工。

### 2026-09-04 22:35（F15：完整可审计 transcript 存储改造，issue #2723）
- 本轮目标: 实现 R11(c)——`agent_run_steps` 从"digest+截断摘要"改为"完整内容+字段级
  加密"，新增 `getRunTranscript` 审计接口（仅 `admin` 角色可读，FORBIDDEN 先于
  RUN_NOT_FOUND 判定，防探针）。范围收窄（已在 PR 里如实标注）：本轮只对
  `model_called` 步骤捕获真实完整内容（`system`/`text`，对应 R3'-3"模型看到了什么、
  完整说了什么"）；`tool_call` 的完整参数/结果需要 `deep-agent-model-provider.ts`
  先暴露未截断数据，是明确的后续工作，不是被吞掉的缺口——在此之前 `tool_call` 行
  诚实报 `decryptStatus: "unreadable"`。
- 已完成: 新迁移（`agent_run_steps` 加两列加密全文）；新 cipher 模块
  （`transcript-content-cipher.ts`，AES-256-GCM，与 `aes-credential-cipher.ts` 同构但
  带 decrypt，因为审计接口必须能读回）；`AgentRunStore` 新增
  `readRunTranscriptSteps`；`execute-run.ts` 的 `record()` 与三处 `model_called`
  调用点透传完整内容；新用例 `get-run-transcript.ts`；`agent-run.controller.ts` 新增
  `GET /agent-runs/:runId/transcript`；`kernel.module.ts` 接入 cipher 工厂；新测试
  `tests/agent-run/transcript-full-content-rbac.test.ts`（issue 指定的唯一
  verification 命令，覆盖 V1-V5 各配一条 CP 反证）。
- 运行过的验证:
  - `pnpm --filter api exec tsc --noEmit -p .`：改动到的文件（含因接口新增方法而
    补 stub 的 6 个既有测试假件）0 个新增错误。
  - `pnpm --filter api run lint`（含 `lint-arch-deps`）：全绿。
  - `pnpm harness verify --phase 14 --feature F15`：跑过，在 vitest 全局 DB setup
    阶段因 Docker 出网被拦而失败——与 F01/F13 同一条环境 blocker，非本次改动引入的
    逻辑缺陷。
- 已记录证据: `evidence/F15.verify.log`（真实失败日志 + 本会话已做到的最大验证，
  未手改失败部分）。
- 提交记录: 见分支 `worker/remote-f15-14-f15-transcript-encryption` 的 PR（关联
  issue #2723）。
- 已知风险或未解决问题: F15 尚未 `passing`——需要一个 Docker 出网可用的环境（CI）
  重跑 `pnpm harness verify --phase 14 --feature F15`；`tool_call` 完整内容捕获是
  已标注的后续工作，不在本 PR 范围。
- 下一步最佳动作: 等 CI 跑通该 verification 命令；CI 若发现测试本身有问题需要在本
  PR 上修。
### 2026-09-04 23:00 (owner: remote)
- 本轮目标: 实现 Phase 14 F10（前端产出物面板：版本历史查看与基于某版本继续修改，
  issue #2719）。
- 已完成: 新增 `apps/web/tests/agent-kernel/artifacts-panel.test.tsx`，固化
  `ArtifactsPanel`（`agent-kernel-units.tsx`，ui-prototyper 在 `artifacts-steering`
  契约束签核阶段已建成的原型组件）的 user_visible_behavior：空态
  `data-testid=artifacts-panel` 内含 `empty` 节点且不渲染版本历史；有版本时
  `artifact-version-{n}` 逐条存在、最新版本默认 `aria-pressed=true`、点击切换正确
  翻转并联动预览区文本；`artifact-view`/`artifact-continue` 均存在且可点击。
  组件本身无需改动（原型已满足全部断言面），只补测试门控。
  同时把 F10 的 `sprint` 字段由 `null` 改为 `"01"`（经 `lib/features.ts` 的
  `loadFeatureList`/`saveFeatureList` 读写），使其纳入本 sprint 的
  `active-features.json` 派生视图。
- 范围说明（未做的部分，如实记录）: F09 目前只有应用层用例
  （`application/artifacts-steering/`）与 `PgArtifactStore`，尚未暴露任何 HTTP
  控制器；`continueArtifact` 的 `ArtifactRunLauncher` 端口在
  `application/artifacts-steering/ports.ts` 里明确声明"只定义端口，不提供生产
  实现"，注释原文认为接线是"很可能是 F10 或 F11 落地时"的范围。但 F10 在
  `feature_list.json` 里的 `notes` 明确把依据等级标注为 `[原型]`，唯一
  verification 命令是纯组件级 vitest（不依赖后端/网络），且断言面逐字列出的只是
  UI 交互（testid、aria-pressed、按钮存在性），不包含任何"改为真实网络请求"的
  断言——因此本轮判断"接 HTTP 控制器 + 把按钮 onClick 换成真实 fetch"超出本条
  feature 的权威断言面，属于顺手扩大范围（AGENTS.md「范围纪律」），未做；沿用
  同 sprint F14（`error-card.test.tsx`）已确立的先例（同样是给已建原型补回归
  测试，不接后端）。
- 运行过的验证:
  - `pnpm --filter web exec vitest run tests/agent-kernel/artifacts-panel.test.tsx`：
    7 个测试全绿。
  - `pnpm exec tsc --noEmit -p apps/web`：0 个错误。
  - `pnpm harness verify --sprint 14/01 --feature F10`：F10 自身 verification 命令
    通过；后置的 `verify:quick` 基础验证里 `turbo run typecheck lint test
    --affected` 本身 5/5 成功、2834/2834 测试全绿，但收尾阶段
    `[test-isolation] cleanup failed: docker compose down -v exited 1` 导致整条
    命令以 exit 1 结束，从而拒绝把 F10 升为 `passing`（见下）。
- 当前 blocker（与 F01/F13 同一类环境限制，但故障点不同，如实分列）: 本会话沙箱
  没有 Docker daemon（`docker info` 报
  `connect: no such file or directory /var/run/docker.sock`），`verify:quick`
  收尾时对测试隔离命名空间执行 `docker compose down -v` 清理，因守护进程根本不
  存在而以 exit 1 结束，拖累整条 `verify:quick` 判失败——**不是本次改动引入的
  逻辑缺陷**：F10 自身测试、以及 turbo 报告的全部 2834 个测试均已通过，失败点
  在测试运行本身完成之后的清理步骤。已按 issue 指示如实记录、未修改测试基础设施
  本身去绕开这条环境限制。
- 已记录证据: `evidence/F10.verify.log`（真实失败日志，未手改，含
  `Test Files 307 passed (307)` / `Tests 2834 passed (2834)` 与随后的
  `docker compose down -v exited 1`）。
- 提交记录: 见分支 `worker/remote-14-f10-artifacts-panel` 的 PR（关联 issue #2719）。
- 已知风险或未解决问题: F10 尚未 `passing`——需要一个有 Docker daemon 的环境重跑
  `pnpm harness verify --sprint 14/01 --feature F10`（F01/F13 的 Postgres 出网
  blocker 待补跑同理）。
- 下一步最佳动作: 在有 Docker daemon 的环境重跑本 feature 的 verify 把状态转
  `passing`；F10 之后，若人类在 design-signoff 第③点上拍板
  `continueArtifact`/`interject` 的接线归属，可评估是否需要新增 feature 把
  `ArtifactRunLauncher`/HTTP 控制器接上（当前 F09～F12 四个 feature 均未显式
  覆盖这条 HTTP 暴露面，只有应用层用例）。
