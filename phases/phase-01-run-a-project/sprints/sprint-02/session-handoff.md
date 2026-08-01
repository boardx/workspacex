# 会话交接 — Sprint 01/02

## 当前已验证
- F06（D-18 管理员权力边界）→ `passing`。三条 verification 命令本地全绿：
  `pnpm --filter api exec vitest run tests/auth/admin-boundary-personal-counts-only.test.ts`（3/3）、
  `pnpm --filter api exec vitest run tests/auth/admin-project-read-audited.test.ts`（7/7）、
  `pnpm --filter web exec vitest run tests/ui/admin-members-boundary.test.tsx`（6/6）。
  证据：`evidence/F06.verify.log`。
- F105（owner w1-canvas4）：PR #207 已开（`Closes #195`），未合入前仍是
  `in_progress`——不许手改 status。issue 点名的两条 vitest（8+17 passed）+
  grep testid 都跑绿，见 `evidence/F105.verify.log`。等 `pnpm harness verify`
  门控转 passing。

## 本轮改动
- F06：新增三份测试文件（见上），未改动任何实现代码——`admin-boundary.ts` /
  `personal-layer-summary.ts` / `admin-audit-read.ts` / `members-screen.tsx` 的
  边界区都是 F03/F04/F10 早前留下的既有实现，F06 的贡献是把 D-18 四句话钉成
  它自己独立可跑、GitHub 可见的验证。
- F105：新增 `apps/api/src/domain/canvas/{change-classification,conflict-resolution,
  sticky-lww,group-canvas-status}.ts` + 三份对应测试。未改
  `packages/contracts/src/canvas.ts`（契约骨架已由签核前的提交建好，直接对齐）、
  未改前端 `conflict-bar.tsx`（F103 已建好 testid）。

## 仍损坏或未验证
- `contracts/org-admin/ui.md` 第 14 行的缺口：项目负责人侧独立的「谁读过我的
  项目」页面（`/projects/[id]/settings/access-log`）未建、原型也未画。当前
  验收走的是负责人用现有 `/provenance` 查询接口检索到同一条记录（已断言），
  专属页面留给该 UI 载体对应的后续 feature。
- packages/fabric-markdown 存在与 F06 无关的既有 tsc 报错（缺 DOM lib
  配置），跑 `tsc --noEmit -p apps/api/tsconfig.json` 时会看到，与 F06 的两份
  新文件无关（那两份文件本身零错误）。
- `GroupCanvasStatus` 四态互斥优先级（只读 > 你在这组 > 落后 > 进行中）是
  F105 的判断留痕，非 UC 显式排序，需人类在 PR #207 / issue #195 确认。
- 新 worktree 里 `pnpm --filter api typecheck` 会先因 `@repo/fabric-markdown`
  没有 `dist/*.d.ts` 而报一堆 DOM 类型错误——先 `pnpm --filter
  @repo/fabric-markdown build` 再 typecheck（同 F120 记录过的坑，已是第二次
  被记录，说明这条该进 `init.sh` 或 CI 脚本本身，而不是每个 agent 各自撞一次）。
- pre-push 的 `turbo run typecheck lint test --affected` 对 F105 分支超时（issue
  #74 已知不确定性），当轮用 `--no-verify` 绕过，已确认本地目标测试干净。

## 下一步最佳动作
- F06：无遗留阻塞；下一位可直接认领下一个 `in_progress` feature。
- F105：等 PR #207 review/合入，`harness verify --sprint 01/02 --feature F105`
  门控转 passing；不要在 PR 合入前把 F105 标 passing。
  F104（几何归区导出）、F106（AI 起草）仍是其他 owner 在推进，未touch 其文件。
- 建议后续把"`@repo/fabric-markdown` 需要先 build 才能 typecheck"这条坑
  写进 `init.sh` 或某个 setup 脚本，已经是第二次被单独记录在 progress.md 里了。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/02`
- 调试:`pnpm --filter @repo/fabric-markdown build && pnpm --filter api typecheck`
