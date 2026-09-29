# Iteration 9 Acceptance Report — CT08

Generated: 2026-09-29

## Features Under Test

| Feature | Title | Status |
|---------|-------|--------|
| CT08 | 销售线 Workflow 定义（W011–W016/W018） | ACCEPT (all verification pass; UI journey BLOCKED by env) |

---

## 1. Static Analysis & Typecheck

| Check | Exit Code | Result |
|-------|-----------|--------|
| `pnpm --filter @repo/contracts typecheck` | 0 | PASS |
| `pnpm --filter api typecheck` | 0 | PASS |
| `pnpm --filter web typecheck` | 0 | PASS |
| `node .harness/scripts/lint-arch-deps.mjs` | 0 | PASS — 1723 files, all dependencies point inward |
| `node .harness/scripts/lint-contract-source.mjs` | 0 | PASS — 1158 contract types, no hand-written copies |
| `./init.sh` | 0 | PASS |

---

## 2. Feature Verification Commands

### CT08 — sales-workflow-definitions.test.ts

Command:
```
pnpm --filter api exec vitest run tests/work-content/sales-workflow-definitions.test.ts
```

Exit code: **0**

```
RUN  v2.1.9 /home/user/wt/ct08/apps/api

[db-isolation] selection is DB-free (tests/support/db-free-tests.ts); skipping database setup
 ✓ tests/work-content/sales-workflow-definitions.test.ts (8 tests) 115ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  01:09:37
   Duration  2.74s
```

Tests exercised:
1. 每个定义都产出合法 runtime 元数据，graphRef = key:version
2. 副作用分类按 capability 一致：crm.write/notify.inapp → write，mail.send → external_send（W014 §能力映射）
3. W011 阶段顺序与 §5 一致，S021 扩充并发 5，G1 在 review，写回 crm.write + 通知 notify.inapp
4. W013 会后三联决策：G1 绑定三份 digest，新商机五字段、延后 amount/closeDate/stage，G2 + mail.send 独立
5. W018 S021 与 S009 同属 gathering 并行组
6. 按 work-sales 包注册：pin 全部可解析的可用；W012 引用未入包的 S027 → 仅它不可用
7. 未解析引用报错不影响其它：去掉 S009 只让 W013/W018 不可用
8. 版本不匹配也算未解析；形状非法的模块只把自己标为不可用

### CT08 — sales-skillpins-matrix.test.ts

Command:
```
pnpm --filter api exec vitest run tests/work-content/sales-skillpins-matrix.test.ts
```

Exit code: **0**

```
RUN  v2.1.9 /home/user/wt/ct08/apps/api

[db-isolation] selection is DB-free (tests/support/db-free-tests.ts); skipping database setup
 ✓ tests/work-content/sales-skillpins-matrix.test.ts (10 tests) 83ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  01:09:45
   Duration  2.72s
```

Tests exercised:
1. 恰好覆盖 W011–W016 与 W018，不含 W017
2. W011–W018 各工作流的 skillPins 集合等于矩阵行（7 parametric tests）
3. 跨线引用：W013 引用 S009，W018 引用 S035/S036/S009，W016 引用 S010/S033
4. 每个 pin 固定到 work-sales 包中该 Skill 的 semanticVersion（包外的 pin 只允许 S027，且登记为未解析）

Total: 18 tests, all pass.

---

## 3. End-to-End Stack / Playwright Journey

### Stack startup attempt

```
flock .lock bash -c 'WSX_REPO=/home/user/wt/ct08 WSX_RESET_DB=1 WSX_REBUILD_WEB=1 ./start.sh'
```

- PostgreSQL (55432), Redis (56379), loopback model (27100), API (24100): started
- Web (Next.js production build): **KILLED by OOM** during `next build` linting/type-check phase

Web log evidence:
```
▲ Next.js 14.2.15
   Creating an optimized production build ...
 ✓ Compiled successfully
   Linting and checking validity of types ...
bash: line 1: 16549 Killed  next build
```

Stack was stopped cleanly via `./stop.sh` (all services confirmed stopped).

### Journey status

| Journey | Expected walkable (I9) | Result |
|---------|----------------------|--------|
| D005-J1 线索到合格 (W011) | Full I9 | BLOCKED: web OOM during next build |
| D005-J2 会后更新 CRM (W013) | Full I9 | BLOCKED: web OOM during next build |
| D005-J3 CRM 拒绝/冲突/重放 | Full I9 | BLOCKED: web OOM during next build |

**Blocking reason**: `next build` is OOM-killed by the kernel during the TypeScript/lint phase (same as CT07 iteration). This is a persistent infrastructure constraint — the container does not have enough memory headroom for the full Next.js production build. This is NOT a code defect in CT08.

CT08 is entirely a backend code-definition feature (pure TypeScript workflow definitions, no UI code). Its user_visible_behavior — W011–W016/W018 definitions producing valid runtime metadata with correct skillPins — is fully validated by the 18-test vitest suite. The D005 Playwright journeys are execution-plane journeys that require CT09 (catalog registration), WF03 (runtime), WF08 (run panel UI), and D005-agent routing — all of which depend on the full stack.

---

## 4. Conclusion

**CT08: ACCEPT**

All 18 verification tests pass (8 + 10). Static analysis, all 3 typechecks, arch-deps, and contract-source lints are green. init.sh passes.

The Next.js full-stack Playwright journey is BLOCKED by OOM (infrastructure constraint, not code failure). CT08 has no UI-specific behavior to test independently.

Gaps to carry forward:
- D005-J1/J2/J3 full Playwright journeys (BLOCKED by OOM; consistent with iter9 CT07 report)
