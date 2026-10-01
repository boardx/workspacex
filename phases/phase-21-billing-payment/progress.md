# 进度日志 — Phase 21 billing-payment

## 当前已验证状态(唯一真相)
- 仓库根目录: /Users/shenyangjun/boardx/workspacex（当前工作分支：`codex/interview-acceptance-optimizations`，本阶段全部产物**尚未提交**）
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: 15 个 feature 就绪（0 开工，全部 `not_started`，占位 id `F-TBD-*` 待 claim 取号）
- 当前 blocker: 无；下一道门 = **人类签核**（束级 `design-signoff.md` ×2 + 阶段 `design-coherence.md`，S6）

## 会话记录

### 2026-10-01 立项会话（Claude Code，人类直派「立项并按 harness 实现支付」）
- 本轮目标: 立项 Phase 21（billing-payment），参考 boardx-backend / boardx-web 全量对齐支付能力；完成「需求 → UI 先行 → 契约束 → feature_list」并交人类签核。
- 已完成:
  - `requirements/` 5 份（00-overview / 01-credits-topup / 02-payment-order-notify / 03-subscription-stripe / 04-billing-admin），`hasRequirementsCoverage` ✅。
  - **UI 先行**：ui-prototyper 交付 `/preview/billing` 原型（`apps/web/app/preview/billing/page.tsx`、`apps/web/components/billing/*`、`apps/web/lib/mock/billing.ts`、`apps/web/scripts/shot-billing.mjs`）；31 张截图按束落 `ui-preview/billing-credits/`(24) 与 `ui-preview/billing-subscription/`(9)，原图保留。
  - **契约束两束支撑材料**：`contracts/billing-credits/{domain,usecases,coverage,ui}.md`、`contracts/billing-subscription/{…}.md`。
  - **签核③（契约单源）**：`packages/contracts/src/billing-credits.ts`（12 operations）、`billing-subscription.ts`（4 operations），`src/index.ts` 已导出；未跟踪骨架 `src/payment.ts` 作废（实现期删除）。
  - **接线**：`apps/web/lib/navigation.ts`（`billing-preview` isPrototype 条目）、`admin-nav.tsx` `MERGED_SECOND_LEVEL_KEYS`、`.harness/scripts/nav-reachability.config.json`（phase-21 段 + 其余四阶段 allowRoutes 补 `/preview/billing`）、`.harness/scripts/ui-material-map.json`（phase-21 两行）。
  - **阶段一致性复核底稿**：`design-coherence.md`（status: pending，待人类）。
  - **权威功能清单**：requirement-author 交付 `feature_list.json`——**15 个 feature / 78 点**（billing-credits 12 + billing-subscription 3），全部锚定真实 `R<n>` 章节与可执行 vitest 命令，wave 1–4 依赖分层；占位 id `F-TBD-*`（#1094：claim 时原子取号并同步改写 covers）。
  - **签核材料补齐**：两束 `design-signoff.md` 已填 `covers:`（12 + 3 个占位 id）；5 份 requirements 已补 `估点 **n**` 头部（4/15/19/16/24，与 feature 点数和机械对账）。
- 运行过的验证（实测全绿）:
  - `pnpm exec tsx .harness/scripts/lint-ui-material.mjs phase-21-billing-payment` → 24/24、9/9 ✅
  - `pnpm exec tsx .harness/scripts/lint-nav-reachability.mjs` → 五阶段全绿（phase-21 束可达 2/2）✅
  - `pnpm exec tsx .harness/scripts/lint-third-artifact.mjs` → 两束均形态 A ✅
  - `pnpm --filter @repo/contracts typecheck` ✅；`node .harness/scripts/lint-contract-source.mjs` ✅
  - `pnpm --filter web exec vitest run tests/ui/admin-menu-dedup.test.tsx` → 9/9 ✅
- 已记录证据: `phases/phase-21-billing-payment/ui-preview/`（31 张，README 有屏↔UC 映射）；本文件上方门控命令输出。
- 提交记录: **未提交**（全部为工作区改动；建议材料齐后单独提交并发 PR，人类在 PR 里完成签核——遵循 human-decision-packaging 单 PR 交付）。
- 人类决策记录（2026-10-01 对话，AskUserQuestion 四题）：
  1. 材料落库 = **独立分支**（已建 worktree `/Users/shenyangjun/boardx/workspacex-p21`，分支 `design/phase-21-billing-payment`，基于 origin/main；全部产物已搬运，`packages/contracts/src/index.ts` 补回主线 tagInputLimits 导出）。
  2. 签核方式 = **对话确认，agent 回填** `confirmed_*`（PR 流程后续补）。
  3. credits Q5 裁决 = **仅 owner/admin**（契约现状，成员不可读组织钱包/流水）。
  4. Stripe 异常态裁决 = **原样落库含 past_due**（`invoice.payment_failed` 纳入 webhook 覆盖，避免"有枚举无写入路径"）。
- 已知风险或未解决问题:
  - `design-signoff.md` ×2 待写（等 requirement-author 产出 feature 编号后填 `covers:`），随后交人类签核；`design-coherence.md` 同为 pending。
  - 游离骨架 `apps/api/src/{infrastructure/payment,interface/controllers/payment.controller.ts,tests/payment}`、`packages/contracts/src/payment.ts`、`apps/api/docker/postgres-init/` 待实现期裁决（删除/并入），当前保留以免丢失上下文。
  - 协调身份：`registry.yaml` 无 phase-21 身份；claim/verify 前需人类注册 id（或明确豁免）。
  - UI 原型 mock（`lib/mock/billing.ts`）为界面投影，实现期需按 ADR-020 收敛为从契约生成。
- 下一步最佳动作: 人类签核（决策包已发：材料提交策略 / 签核方式 / 两个设计裁决）→ 回填 `status: confirmed` 走签核 PR → `pnpm harness new-sprint --phase 21 --id 01` + `pnpm harness sync --phase 21 --apply` 建 issue → 逐 feature 实现。

- 签核完成（2026-10-01T03:23:47Z）：两束 `design-signoff.md` + `design-coherence.md` 均回填 status: confirmed（confirmed_by: usamshen；人类对话确认，agent 按指示代为回填）；裁决记录入签核文件；doctor 0 FAIL。
