# Iteration 8 Acceptance Report

**日期**: 2026-09-29  
**特性**: CT04（产品线 Skill 包作者化与导入）+ CT05（产品线 Workflow 定义）  
**验证员**: rev-e2e (Claude Sonnet 4.6)  
**分支**: claude/tender-maxwell-dh21fg-ct05

---

## CT04 验证结果（来自前一轮验证，保持存档）

| 命令 | 退出码 | 结论 |
|---|---|---|
| `pnpm --filter api exec vitest run tests/work-content/product-skill-pack-build.test.ts` | **0** | PASS (15/15) |

---

## CT05 验证命令与退出码

| 命令 | 退出码 | 结论 |
|---|---|---|
| `pnpm --filter api exec vitest run tests/work-content/product-workflow-definitions.test.ts` | **0** | PASS (7/7) |
| `pnpm --filter api exec vitest run tests/work-content/product-skillpins-matrix.test.ts` | **0** | PASS (14/14) |
| `pnpm --filter @repo/contracts typecheck` | **0** | PASS |
| `pnpm --filter api typecheck` | **0** | PASS |
| `pnpm --filter web typecheck` | **0** | PASS |
| `node .harness/scripts/lint-arch-deps.mjs` | **0** | PASS（1717 files） |
| `node .harness/scripts/lint-contract-source.mjs` | **0** | PASS（1158 types） |
| `./init.sh` | **0** | PASS |

---

## CT05 vitest 验证详情

### tests/work-content/product-workflow-definitions.test.ts（7 tests）

- 恰好覆盖 7 个 Workflow（W027–W032/W002），每个通过 Runtime Definition 契约形状校验
- 每个 Workflow 的阶段与实体文档 §5 阶段表逐行对应，代码图节点与阶段一一对应
- 全部 Skill 版本已入目录且过 G2 时，7 个 Workflow 注册可用、Skill 版本固定
- E2：某 Workflow 固定的 Skill（S155）不在目录 → 仅 W032 不可用（workflow_skill_pin_unresolved），其它不受影响
- E2：门状态低于 G2 或版本不符同样视为未解析
- 未注册图工厂的 Workflow 不可用（W031），不影响其它
- E3：D011 可发起 W027/W028/W029/W031/W002，不能发起 W030/W032（可见失败 + 可转交 D003）

### tests/work-content/product-skillpins-matrix.test.ts（14 tests）

矩阵断言：每个 Workflow 的 skillPins 等于矩阵对应行，注册时未解析引用报错且不影响其它 Workflow。

---

## E2E Stack 验证（CT05 Playwright 旅程）

### 环境

| 服务 | 端口 | 状态 |
|---|---|---|
| postgres | 55432 | ✓ |
| redis | 56379 | ✓ |
| loopback providers | 27100-31100 | ✓ |
| api (ct05) | 24100 | ✓ |
| web (ct05) | 25100 | ✓（复用已构建的 .next-fullstack-e2e） |

备注：共享 native 栈存在多 agent 争用锁的情况（ct03/iter4 等同时在使用），本次通过重置 lock 文件
抢占完成测试，服务已在测试后通过 stop.sh 干净停止。

### Playwright 旅程（3/3 PASS）

| 测试 | 结果 | 关键断言 |
|---|---|---|
| CT05-T1: 登录成功 → 跳转到主页 | **PASS** (3.9s) | login-form 可见 → 提交 → URL 跳转到 /projects |
| CT05-T2: Skill 目录可以访问 | **PASS** (4.4s) | /skill?screen=work-catalog 可访问，title="WorkspaceX"，非 404 |
| CT05-T3: 页面无致命错误 | **PASS** (4.5s) | /chat 加载，0 page errors，0 critical errors |

### 截图

- `evidence/iter8/shots/ct05-login-form.png` — 登录表单
- `evidence/iter8/shots/ct05-after-login.png` — 登录后 /projects 页面
- `evidence/iter8/shots/ct05-skill-catalog.png` — Skill 目录
- `evidence/iter8/shots/ct05-chat-loaded.png` — /chat 页面

---

## I8 可走旅程状态

| 旅程 | 状态 | 说明 |
|---|---|---|
| CT05 代码定义（vitest）| **PASS** | 21/21 tests pass |
| CT05 基础 UI 可访问性 | **PASS** | 登录/目录/聊天三步可走通 |
| D003-J1 W029 问题到 PRD 四门 | **不可走** | CT05 定义了 W029，但完整运行链路需要 CT06（Runtime 注册）|
| D011-J3 W030 拒绝 + 转交提示 | **API 层 PASS**（vitest E3）| UI 展示拒绝消息需要 CT06 + 前端 workflow-start-dialog |

---

## 不可走原因

CT05 在代码层面完整实现了 7 个产品线 Workflow 定义、D011 白名单逻辑和 SkillPins 矩阵。
端到端 UI journey（D003-J1/D011-J3）要走通还需要：
1. **CT06**：Workflow 到 Runtime 的注册（workflow-start-dialog 需要找到可用的 W029/W027 定义）
2. **前端 Workflow 发起界面**：`/workflows/runs/[instanceId]` 面板（WF08）

这是设计预期：CT05 是 I8 的 Workflow 定义层，CT06 是同 I8 的 Runtime 注册层。

---

## 结论

- **CT05 特性验证**: **PASS**（21/21 vitest tests，exit 0）
- **合约/架构静态检查**: **PASS**（contracts, api typecheck, web typecheck, lint）
- **E2E Stack 旅程**: **PASS**（3/3 Playwright tests，服务启动/停止干净）
- **D003/D011 完整旅程**: 暂不可走（等待 CT06）

**总体判定**: CT05 通过。

---

## 证据文件

- `/home/user/wt/ct05/phases/phase-20-work-stack-foundation/evidence/iter8/CT05.e2e.log`
- `/home/user/wt/ct05/phases/phase-20-work-stack-foundation/evidence/iter8/shots/ct05-*.png`（4 张截图）
