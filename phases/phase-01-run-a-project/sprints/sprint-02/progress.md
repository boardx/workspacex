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

### 2026-08-01（F06，owner w1-auth6）
- 本轮目标：F06 —— D-18 管理员权力边界（个人层只见计数、项目层可读留痕且对项目
  负责人可见）的独立、GitHub 可见验证。依赖 F04（`in_progress` 但已合入
  `origin/main` #162，代码稳定；按协调者裁决不算 blocker，照常开工）。
- 开工前发现：三条 verification 对应的测试文件与 `admin-members-screen.tsx` 的
  边界区（`admin-members-boundary` 等 testid）已经存在——后端判定逻辑
  （`admin-boundary.ts` / `personal-layer-summary.ts` / `admin-audit-read.ts`）
  与前端 UI 都是 F03/F04/F10 早前工作留下的，本 feature 真正要交付的是把
  D-18 的四句话断言当作 F06 自己的、独立可跑的验证单元钉死下来（而不是依赖
  F03 的 `tests/kernel/*` 顺带覆盖到）。
- 已完成：新增 `apps/api/tests/auth/admin-boundary-personal-counts-only.test.ts`
  （D-18 第①④句：个人层计数、无内容字段、admin 对该条目任何 purpose 都拒绝）、
  `apps/api/tests/auth/admin-project-read-audited.test.ts`（D-18 第②③④句：
  audit 读成功+留痕、负责人可查、admin 本人「看我的访问记录」看到同一条 id、
  work 读仍拒绝且不留痕、单独持项目角色时正常读取且不触发 admin-project-access）、
  `apps/web/tests/ui/admin-members-boundary.test.tsx`（个人层只显示计数徽标、
  项目层说明文案、内联访问记录列表与「看我的访问记录」抽屉展示同一批记录）。
  未改动任何实现代码——三份新测试打的都是既有实现。
- 运行过的验证：三条 verification 命令均在本地（含真实 Postgres）跑绿：
  `admin-boundary-personal-counts-only.test.ts`（3/3）、
  `admin-project-read-audited.test.ts`（7/7）、
  `admin-members-boundary.test.tsx`（6/6，纯 jsdom，无需 DB）。
  另跑过 `pnpm --filter api exec tsc --noEmit`，两份新文件零错误（仓库里
  `packages/fabric-markdown` 的既有 DOM lib 报错与本 feature 无关，未处理）。
- 已记录证据：`evidence/F06.verify.log`。
- 提交记录：`pnpm harness verify --sprint 01/02 --feature F06` 门控通过，
  F06 → `passing`；分支 `worker/w1-auth6-01-F06`，PR 关联 issue #181
  （`Closes #181`）。
- 已知风险或未解决问题：`contracts/org-admin/ui.md` 第 14 行标注「项目负责人侧
  『谁读过我的项目』独立页面（`/projects/[id]/settings/access-log`）未建，且
  原型未画」——本 feature 的验收锚点走的是 `/admin/members` 已建成的边界区
  （负责人可用现有 `/provenance` 查询接口检索到同一条记录，测试已断言），
  独立的负责人侧专属页面仍是缺口，留给该 UI 载体对应的后续 feature。
- 下一步最佳动作：无遗留阻塞；下一位可直接认领下一个 `in_progress` feature。

### 2026-08-01（F105，owner w1-canvas4）
- 本轮目标：F105 —— 便签级 LWW + 结构性冲突条人工裁决三出口（D-09）+ 判定表(O-32)
  + 状态 enum。依赖 F103（真实 mermaid 渲染，已合入 main，issue #98 CLOSED——
  issue #195 正文里"未就绪"是 sync 生成时的旧投影，已核实不影响开工）。
- 已完成：
  - `apps/api/src/domain/canvas/change-classification.ts` —— `classifyChange`
    全函数判定表（七行穷举），O-32「便签跨分区移动归 sticky-level」重点断言。
  - `apps/api/src/domain/canvas/conflict-resolution.ts` —— `applyStructuralChange`
    （单侧直接同步，两侧同时改才产生 conflictId，I-16）+ `resolveConflict` 三出口
    （`preservedVersionId` 永不为空，D-09/I-17；`compare` 中间态；幂等重放）。
  - `apps/api/src/domain/canvas/sticky-lww.ts` —— `applyStickyChange` 便签级 LWW，
    `supersededRevisionId` 可查到被覆盖的那次（I-19）。
  - `apps/api/src/domain/canvas/group-canvas-status.ts` —— `computeCompleteness` +
    `computeGroupCanvasStatus`（落后当且仅当必填分区为空，不跨组横向比较，
    I-20/I-21）+ 停滞阈值默认 5 分钟可配置（O-32）。
  - `canvas-conflict-bar` 等 data-testid 已由 F103 建成，未改前端组件。
- 运行过的验证：issue 点名的两条 vitest（8 + 17 passed）、附加
  `sticky-lww-and-group-status.test.ts`（12 passed）、grep testid、
  `pnpm --filter api typecheck`（需先 `pnpm --filter @repo/fabric-markdown build`
  产出 dist/*.d.ts，同 F120 记录过的坑）、`pnpm --filter api lint`、全部既有
  `apps/api/tests/canvas/**`（169 tests）复跑仍全绿。
- 已记录证据：`evidence/F105.verify.log`。
- 提交记录：分支 `worker/w1-canvas4-01-F105`，PR #207（`Closes #195`）。
- 已知风险或未解决问题：`GroupCanvasStatus` 四态互斥优先级（只读 > 你在这组 >
  落后 > 进行中）是本次判断留痕，非 UC/契约显式排序，已在 PR 描述与 issue 评论
  里点名请人类确认。push 时 pre-push 的 `turbo run typecheck lint test --affected`
  超时（issue #74 已知不确定性），已按标准授权 `--no-verify` 推送。
- 下一步最佳动作：F104（几何归区导出）与 F106/F107 仍待其他 owner 推进；
  本 feature 的三个后端判定模块（classify/lww/resolve/status）都是纯函数，
  与 F104 的 export-source 路径无重叠，无需协调。
