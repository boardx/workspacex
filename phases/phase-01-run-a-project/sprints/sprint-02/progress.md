# 进度日志 — Sprint 01/02

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- 当前最高优先级未完成功能: <feature id / title>
- 当前 blocker: <无 / 描述>

## 会话记录
### 2026-07-31 04:30:23
- 本轮目标:
- 已完成:
- 运行过的验证:
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题:
- 下一步最佳动作:

### 2026-08-01（F120，owner w3-project2）
- 本轮目标：F120 —— STEP_CLOSED / STEP_REJECTS_ARTIFACT_TYPE 两条 phase-00 空转失败码的
  双向还债（依赖 F118 的 agenda_segments + 外键，已 passing）。
- 开工前发现：`feature_list.json` 里 F119/F120/F121 的 `sprint` 字段是 `null`（与
  `chore(sync): F19/F20/F21/F50/F64/F65 补 sprint 字段` 同一根因），`sync-github.ts`
  从未为它们建过 issue。未touch `feature_list.json`（授权外），改为照
  `buildIssueBody` 模板手工建了 issue #135；随后 origin/main 出现
  `22739fc chore(sync): 补齐 15 个 feature 的 sprint 字段` 已把这三个都修了——
  与我的手工 issue 并存，未来 `harness sync --apply` 可能会为 F120 再建一条投影
  issue，留给下一位处理（marker 是 `<!-- harness-feature: 01/F120 -->`，两条能
  互相识别）。
- 已完成：`evaluateStepGate` 纯函数（domain/project/step-gate.ts）+
  `bindToProjectStep` 里新增 `assertStepGate` 网关（STEP_CLOSED 优先于
  STEP_REJECTS_ARTIFACT_TYPE）+ `BindingRepository.findArtifactSource` /
  `findSegmentGate` 两个只读方法（Postgres 实现）。
- 运行过的验证：`pnpm --filter api run typecheck`（需先
  `pnpm --filter @repo/fabric-markdown run build`，见 D-17，已知坑与本 feature
  无关）、`pnpm --filter api run lint`、`pnpm --filter api exec vitest run
  tests/project/step-gate.test.ts`（纯逻辑，本地跑绿）、
  `pnpm --filter @repo/contracts run test`。两条 DB 集成测试
  （step-closed-bidirectional / accepted-sources-whitelist）只过了 typecheck，
  未在本地执行（issue #74 的本地策略：不跑需要 Postgres 的测试）。
- 已记录证据：`evidence/F120.verify.log`。
- 提交记录：分支 `worker/w3-project2-01-F120`。
- 已知风险或未解决问题：`setAcceptedSources` 用例本身（引导师写白名单的路径）未接
  HTTP controller / kernel.module.ts DI——理由见 evidence log 末尾；`ui.md` B-4
  的白名单控件原型也还不存在。两条 DB 集成测试的真实执行结果待 CI / test-runner
  补齐。
- 下一步最佳动作：F119（advanceAgendaSegment）与 F121（改名对齐）仍在其他 owner
  的分支上并行；`setAcceptedSources` 的 HTTP 落地建议放到明确认领它的下一个
  feature，避免三个 agent 同时抢 kernel.module.ts 的同一段。
