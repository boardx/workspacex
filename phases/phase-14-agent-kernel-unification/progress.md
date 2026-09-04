# 进度日志 — Phase 14 agent-kernel-unification

## 当前已验证状态(唯一真相)
- 仓库根目录: `/home/user/workspacex`
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F09（Artifact 领域模型 + 版本化 API）——实现完成，
  issue 指定的两条 verification 命令真实跑通，`in_progress`（`pnpm harness verify`
  的 `--sprint` 门控需要 docker 可用的环境才能把 status 翻成 `passing`，见下）
- 当前 blocker: 本会话沙箱没有运行中的 dockerd、且组织出网策略拦截 Docker Hub 镜像拉取
  （`pgvector/pgvector:pg16` 对 `production.cloudfront.docker.com` 返回 403），与 F01
  记录的环境限制同源。本会话额外用 apt 装了 postgresql-16+pgvector 与 redis-server
  （不经 Docker），配合一个不在仓库内的临时 `docker` shim 把测试基建原本发给
  `docker compose exec postgres|redis` 的探活/建库调用改发给这两个真实本地服务，
  使 issue 指定的两条 verification 命令、以及 `tests/agent-run/`+`tests/agent-runtime/`
  全目录（413 用例）都能真实跑通并全绿。`pnpm harness verify --phase 14 --feature F09`
  额外触发的"基础验证"档位判定为 high-risk（`pnpm -w run verify:release`，跑全仓
  typecheck/lint/test，含 apps/web、deep-agent-service 等其余包与 minio 依赖），
  在本沙箱耗时/依赖面远超个人可行范围，未跑完；`--sprint` 门控（唯一能把 status
  翻成 passing 的路径，ADR-012 D5）因此本会话未执行到底。F09 目前不属于任何
  sprint（`feature_list.json` 的 `sprint` 字段为 null），需要先纳入某个 sprint
  才能用 `--sprint` 模式验证。

## 会话记录
### 2026-09-04 17:46:12
- 本轮目标:
- 已完成:
- 运行过的验证:
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题:
- 下一步最佳动作:

### 2026-09-04 22:10:00
- 本轮目标: 实现 Phase 14 F09（Artifact 领域模型 + 版本化 API），对应 issue #2717。
- 已完成:
  - 迁移 `apps/api/migrations/20260905000000_f09_agent_artifacts.sql`：新增
    `agent_artifacts`/`agent_artifact_versions` 两张表（append-only 触发器 + RLS +
    仅 SELECT/INSERT 授权，同 `agent_runs`/`agent_run_steps` 既有形状；命名刻意避开
    phase-00 已占用的 `artifacts`/`artifact_versions`）。
  - 应用层 `apps/api/src/application/artifacts-steering/`：`ports.ts`（`ArtifactStore`/
    `ArtifactRunLauncher`/`ArtifactClock`）、`continue-artifact.ts`（UC-3，I-4/E2 显式
    版本解析）、`record-artifact.ts`（R3 步骤1 建首版 + 步骤5/I-3 失败不计版本）、
    `read-artifact.ts`（UC-1/UC-2，`resolveVisibility`+`discloseDecided` 复用既有可见性
    判定，不新造第二套）、`errors.ts`。
  - 基础设施 `apps/api/src/infrastructure/artifacts-steering/`：`PgArtifactStore`
    （`getArtifact`/`listVersions`/`findVersion` 经 `guard()` 返回 `Guarded<T>`，满足
    `lint-permission-paths.mjs` R7 门控；`appendVersion` 用事务级 advisory lock 序列化
    并发版本号计算，不用 `SELECT ... FOR UPDATE`——那需要 `app_rw` 没有的 `UPDATE` 权限）、
    `SystemArtifactClock`。
  - 两条 issue 指定的 verification 测试（真实 Postgres，非内存 fake）：
    `tests/agent-run/artifact-versioning.test.ts`（连续两次 continue 后版本递增、
    各版本可追溯 run/step、失败尝试不计入）、
    `tests/agent-run/artifact-continue-version-context.test.ts`（`basedOnVersion` 显式
    生效、指定版本不存在时拒绝且不发起新 run、NOT_VISIBLE 分支）。
  - 测试夹具 `apps/api/tests/support/agent-run-db.ts`（`seedAgentRun`/`seedToolCallStep`，
    供需要真实 `agent_runs`/`agent_run_steps` FK 目标的测试直接造行）。
  - `ArtifactRunLauncher` 端口刻意不接生产实现（`ports.ts` 头注）：`continueArtifact`
    发起新 run 具体怎么接 `chat` 束的 `acceptHumanMessage` 是跨束边界，design-signoff
    已标注"待确认"，本 feature 只交付 F09 自己范围内的领域模型/版本化逻辑，不代 F10/F11
    做集成决定。
- 运行过的验证:
  - `pnpm --filter api exec vitest run tests/agent-run/artifact-versioning.test.ts`：通过。
  - `pnpm --filter api exec vitest run tests/agent-run/artifact-continue-version-context.test.ts`：通过。
  - `pnpm --filter api exec tsc --noEmit -p .`：0 个非 baseline（`fabric-markdown`）新增错误。
  - `pnpm --filter api run lint`：0 违规（含 `lint-arch-deps`/`lint-naming-single-source`/
    `lint-permission-paths`）。
  - `pnpm --filter api exec vitest run tests/agent-run tests/agent-runtime`：413 用例全绿
    （本地起了 redis-server 后复跑，原先因 docker/redis 镜像不可用失败的 5 个文件全部转绿，
    确认本次改动未引入回归）。
- 已记录证据: `phases/phase-14-agent-kernel-unification/sprints/sprint-01/evidence/F09.verify.log`
  （issue 指定两条命令的真实输出 + 环境说明）。
- 提交记录: 分支 `worker/remote-f09-14-f09-artifact-versioning-api`，PR `Closes #2717`。
- 已知风险或未解决问题:
  - F09 尚未 `passing`：`pnpm harness verify --sprint 14/<MM>` 需要在 docker 可用的环境
    跑通（触发的 high-risk 基础验证档位是全仓 `verify:release`），本会话沙箱做不到；
    F09 当前也不属于任何 sprint，需要先纳入一个 sprint 才能用 `--sprint` 模式验证。
  - `ArtifactRunLauncher` 无生产实现——`continueArtifact` 的 `out.runId` 目前只能来自
    调用方注入的端口实现；真正把它接到 `acceptHumanMessage`（或其它发起新 run 的机制）
    留给后续 feature（F10 落地前置，或一次专门的接线 feature）。
- 下一步最佳动作: 在 docker 可用的环境重跑 `pnpm harness verify --sprint 14/<MM>
  --feature F09` 把 F09 门控转 passing（沿用 F01 precedent 的下一步建议）；之后按
  R11(b) 排 F10（前端产出物面板，依赖 F09）。
