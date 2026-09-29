# EV05 迭代 7 验收报告

日期：2026-09-29
迭代：Phase 20，iter7（实现轮次 7/10）
特性：EV05 — G5 对比基线批量评测与 verified 通道联动

---

## 1. 迭代位置说明

根据 ACCEPTANCE-JOURNEYS.md 映射：

- I7 = CT01–CT03（内容 token 功能）
- I10 = CT10、CT11、**EV05**、AG07

EV05 是 I10 特性，**iter7 无浏览器可走旅程**。EV05 所依赖的 EV03、EV04 均为 `not_started`，整条链路在 iter7 尚不完整。
本次验收仅覆盖 EV05 的后端单元/集成验证（所有 `verification` 命令）及静态检查。

---

## 2. 静态检查

| 检查 | 命令 | 退出码 |
|---|---|---|
| contracts typecheck | `pnpm --filter @repo/contracts typecheck` | 0 |
| api typecheck | `pnpm --filter api typecheck` | 0 |
| web typecheck | `pnpm --filter web typecheck` | 0 |
| lint-arch-deps | `node .harness/scripts/lint-arch-deps.mjs` | 0 |
| lint-contract-source | `node .harness/scripts/lint-contract-source.mjs` | 0 |

lint-arch-deps: 1756 files, all dependencies point inward
lint-contract-source: 1158 contract types, no hand-written copies

---

## 3. EV05 验证命令（feature_list.json verification）

### V1: g5-baseline-verified.test.ts

命令：`pnpm --filter api exec vitest run tests/work-eval/g5-baseline-verified.test.ts`
退出码：**0**

结果：16 tests passed (16)
耗时：50.77s

通过的测试：
- G5 pass on current version → 200 verified with audit event
- G5 fail (tie) → 409 WORK_EVAL_G5_NOT_PASSED, channel unchanged
- G5 fail (no-baseline) → 409 WORK_EVAL_G5_NOT_PASSED
- G5 fail (must-pass-failed) → 409 WORK_EVAL_G5_NOT_PASSED
- G5 pass only on old version after new import → 409 (record is per version)
- members cannot change channel (403 before gate check)
- candidate skill → 422 UNRESOLVED_SKILL_REF; verified → bound
- pinning candidate onto official agent rejected; verified pin succeeds

### V2: eval-all-skills-batch.test.ts

命令：`pnpm --filter api exec vitest run tests/work-eval/eval-all-skills-batch.test.ts`
退出码：**0**

结果：9 tests passed (9)
耗时：48.67s

通过的测试：
- writes back every skill, verifies exactly G5-pass ones, verified count = G5 pass count
- re-running is idempotent: already-verified skills not re-patched
- verified skill whose new G5 fails → listed in verifiedWithoutG5, batch exits non-zero
- skill missing from catalog reported as error without stopping batch (exit 1)
- server-side rejection of write-back (non platform operator) → WRITE_BACK_FAILED
- discovers skills and produces G5 WorkGateStatus from loopback run with baseline
- without --baseline G5 fails NO_BASELINE (E5)

---

## 4. 浏览器 E2E 旅程

**不适用于 iter7**。

EV05 在 ACCEPTANCE-JOURNEYS.md 中被归为 I10 收口特性，J0-C §5 的 58 行全量 + `work-gate-mark-verified` 按钮均在 I10 才可走。
EV05 的直接依赖 EV03、EV04 均为 `not_started`，无法构成完整链路。

---

## 5. 差距与阻塞

| 差距 | 类型 | 说明 |
|---|---|---|
| 浏览器旅程不可走 | 预期——I10 特性 | EV05 UI 切面（work-gate-mark-verified 按钮、58 行目录）须等 I10 迭代 |
| EV03/EV04 not_started | 依赖未完成 | EV05 的 depends_on 尚未实现；完整 eval 链路不完整 |
| feature status = not_started | 状态字段 | 未由 harness verify 门控推进（验证命令已通过，但状态机未跑） |

---

## 6. 结论

EV05 的两条 `verification` 命令（共 25 个测试）全部通过。
所有静态检查（typecheck × 3、lint-arch-deps、lint-contract-source）退出码 0。
浏览器 E2E 在 iter7 不可走（I10 特性，依赖未完成），属预期差距，不阻塞本轮。

**建议结论：ACCEPT（验证命令通过，静态检查通过；浏览器旅程预期等 I10）**

---

## 7. 证据边界说明（2026-09-29，合入 main 891d15539 后补记）

- 本文件原名 `ACCEPTANCE.md`；合 main 时该路径保留 main 的版本，EV05 的验收报告移到本文件（`-EV05` 后缀）。
- 测试证据范围：`tests/work-eval/g5-baseline-verified.test.ts` 与 `eval-all-skills-batch.test.ts` 使用**夹具技能**
  外加**一次真实回环模型（loopback）运行**；**不是**对线上目录全部 58 个技能的真实评测。
- 「verified 数 = G5 通过数」这一结论目前只在夹具上成立，**仍需生产环境证据**（对真实 58 行目录跑
  `work-eval --all-skills` 并核对写回后的 channel='verified' 计数）。
- 被阻塞的浏览器旅程：J0-C §5 的 58 行全量目录与 `work-gate-mark-verified` 按钮——归 I10 迭代，本轮未走。
