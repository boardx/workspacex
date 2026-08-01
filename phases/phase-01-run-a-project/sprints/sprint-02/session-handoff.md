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
- F145（研究详情四段结果 + Scout 执行步骤，owner w1-research2）确认 `passing`：
  `pnpm --filter @repo/contracts run test`、
  `pnpm --filter api exec vitest run tests/research/run-low-confidence-not-filtered.test.ts`、
  `pnpm --filter api exec vitest run tests/research/run-partial-routes-visible.test.ts`、
  `pnpm --filter web exec vitest run tests/ui/research-detail-four-sections.test.tsx`
  四条均本地跑绿（纯逻辑/组件测试，不连 Postgres）。详见本目录 `progress.md`
  2026-08-01（F145）条目与 `evidence/F145.verify.log`。
- 其余历史条目见 `progress.md`（本文件不复述，避免同一事实两处声明）。

## 本轮改动
- F06：新增三份测试文件（见上），未改动任何实现代码——`admin-boundary.ts` /
  `personal-layer-summary.ts` / `admin-audit-read.ts` / `members-screen.tsx` 的
  边界区都是 F03/F04/F10 早前留下的既有实现，F06 的贡献是把 D-18 四句话钉成
  它自己独立可跑、GitHub 可见的验证。
- F105：新增 `apps/api/src/domain/canvas/{change-classification,conflict-resolution,
  sticky-lww,group-canvas-status}.ts` + 三份对应测试。未改
  `packages/contracts/src/canvas.ts`（契约骨架已由签核前的提交建好，直接对齐）、
  未改前端 `conflict-bar.tsx`（F103 已建好 testid）。
- F145：新增 `apps/api/src/domain/research/result-assembly.ts`（纯函数，实现 N-3/R7.3/
  R7.5/E1/E2 的组装逻辑）+ 两个 api 测试 + 一个 web 测试
  （`apps/web/tests/ui/research-detail-four-sections.test.tsx`）。未改动
  `research` 束已建成的 UI（`RsDetailScreen` / `lib/mock/research-studio.ts`）
  ——那是 ui-prototyper 在 F144 之前建的真实组件+mock，本 feature 只加断言。
- F146（研究列表三处 + 研究计划三计数与证据表：目标缺失渲染「—」而非「0」，
  归档不删除且被引证据不失效）：四条 verification 命令本地全绿，`tsc --noEmit`
  （web 零错误 / api 侧唯一报错在 `packages/fabric-markdown`，与本 feature 无关）、
  `pnpm --filter web run lint` 通过。证据：`evidence/F146.verify.log`。
  ⚠ **状态仍是 `in_progress`，不是 `passing`**——`pnpm -w run verify:base`
  本地在 `apps/api` 既有的 `rbac-role-matrix.test.ts` /
  `reference-eligibility-gate.test.ts` 等 Postgres 集成测试上失败/连接中断，
  与 issue #74 记录的全量连接数竞态同源，非本 feature 引入。按 #74 的既定处理
  方式本地跳过，状态转移留给 CI / test-runner 在干净 Postgres 环境下补跑。

### 本轮改动（F146）
- 新增 `apps/api/src/domain/research/plan-counts.ts`（`derivePlanCounts`：
  `null` 与 `0` 在三计数上保持可区分）与 `archive.ts`（`archiveResearch` /
  `filterByArchived` / `resolveEvidenceById`：归档只置位不删除，证据解析与
  归档状态无关），各配一份对应的纯逻辑测试。
- **修了一个真实缺口**：`RsListScreen`（`apps/web/components/research-studio/
  rs-screens.tsx`）此前硬编码 `filter(i => !i.archived)`，已归档研究**永远
  不出现在任何视图里**，「已归档」标签是纯装饰——效果上把归档做成了删除，
  与 N-7 正面冲突。现在 `RsListScreen` 接收 `sub`（`sub==="archived"` 时改看
  已归档集合，模式与 `RsPlanScreen` 已有的 `sub` 用法一致），`TagRow` 的
  「已归档」标签接了真链接。`research-studio-app.tsx` 把 `sub`/`href` 透传
  给 `RsListScreen`。
- 新增 `apps/web/tests/ui/research-list-target-dash.test.tsx`：分子跟着数据走、
  目标缺失渲染 `—`、Studio 左栏三段独立渲染、归档项可被「已归档」标签筛出且
  格式化规则与未归档项一致、owner/collaborator 两视角列表内容一致。
- 未改动 `packages/contracts/src/research.ts`——所需形状（`Research.archivedAt` /
  `Evidence.confidence` nullable / `getResearchPlan` 三计数 nullable）F144 之前
  已经就位，本次不新增契约类型（避免与 `contract-single-source.test.ts` 冲突）。

## 仍损坏或未验证
- `contracts/org-admin/ui.md` 第 14 行的缺口：项目负责人侧独立的「谁读过我的
  项目」页面（`/projects/[id]/settings/access-log`）未建、原型也未画。当前
  验收走的是负责人用现有 `/provenance` 查询接口检索到同一条记录（已断言），
  专属页面留给该 UI 载体对应的后续 feature。
- packages/fabric-markdown 存在与 F06/F146 无关的既有 tsc 报错（缺 DOM lib
  配置），跑 `tsc --noEmit -p apps/api/tsconfig.json` 时会看到，与这两个
  feature 的新文件无关（新文件本身零错误）。
- `GroupCanvasStatus` 四态互斥优先级（只读 > 你在这组 > 落后 > 进行中）是
  F105 的判断留痕，非 UC 显式排序，需人类在 PR #207 / issue #195 确认。
- 新 worktree 里 `pnpm --filter api typecheck` 会先因 `@repo/fabric-markdown`
  没有 `dist/*.d.ts` 而报一堆 DOM 类型错误——先 `pnpm --filter
  @repo/fabric-markdown build` 再 typecheck（同 F120 记录过的坑，已是第二次
  被记录，说明这条该进 `init.sh` 或 CI 脚本本身，而不是每个 agent 各自撞一次）。
- pre-push 的 `turbo run typecheck lint test --affected` 对 F105 分支超时（issue
  #74 已知不确定性），当轮用 `--no-verify` 绕过，已确认本地目标测试干净。
- `result-assembly.ts`（F145）的两个纯函数还没有接到任何 application 层用例 /
  HTTP controller，留给依赖它的下一个 feature（F146…F148 之一）。
- Q-7 / Q-12 / Q-10 / Q-14 / Q-17 / Q-18 仍未裁，涉及它们的机械断言继续搁置
  （`KNOWN_CONTRACT_GAPS.R8`），不要在裁决前替它们发明枚举。
- F146 遗留：「项目内深度研究列表」目前与 Studio 列表复用同一个 `RsListScreen`
  组件与同一份 mock 数据，未按 `projectRef` 建独立路由/组件；观察者视角下研究
  数据层过滤（E5/R12.5）未在本 feature 的四条 verification 里覆盖，两者都留给
  各自的后续 feature（不在本次 verification 范围内，如实记录不代做）。
- `pnpm -w run verify:base` 本地因 issue #74 记录的 Postgres 连接数竞态不稳定，
  与 F06/F105/F145/F146 均无关。

## 下一步最佳动作
- F06：无遗留阻塞；下一位可直接认领下一个 `in_progress` feature。
- F105：等 PR #207 review/合入，`harness verify --sprint 01/02 --feature F105`
  门控转 passing；不要在 PR 合入前把 F105 标 passing。
  F104（几何归区导出）、F106（AI 起草）仍是其他 owner 在推进，未touch 其文件。
- 建议后续把"`@repo/fabric-markdown` 需要先 build 才能 typecheck"这条坑
  写进 `init.sh` 或某个 setup 脚本，已经是第二次被单独记录在 progress.md 里了。
- F146：CI / test-runner 在干净 Postgres 环境下补跑 `verify:base` 后可
  `pnpm harness verify --sprint 01/02 --feature F146` 把状态门控转 `passing`。
  「项目内深度研究列表」独立路由与观察者数据层过滤（R12.5）建议各自开新
  feature 明确认领。
- 下一轮可从 F147/F148 里挑一个未认领的开始；写组装类纯函数时先看
  `apps/api/src/domain/research/result-assembly.ts` 有没有能直接复用的部分，
  不要重新实现一遍「样本不足判据」或「四段组装」。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/02`
- 调试:`pnpm --filter @repo/fabric-markdown build && pnpm --filter api typecheck`
  / `pnpm --filter api exec vitest run tests/research/*.test.ts`
  / `pnpm --filter web exec vitest run tests/ui/research-detail-four-sections.test.tsx`
  / `pnpm --filter api exec vitest run tests/research/plan-counts-null-not-zero.test.ts`
