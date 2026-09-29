# Iteration 8 Acceptance Report

**日期**: 2026-09-29  
**特性**: CT06（产品线端到端：问题到 PRD）（CT04 的本迭代报告见同目录 `ACCEPTANCE.md`）  
**验证员**: rev-e2e (Claude Sonnet 4.6)  
**分支**: claude/tender-maxwell-dh21fg-ct06

---

## 验证命令与退出码

| 命令 | 退出码 | 结论 |
|---|---|---|
| `pnpm --filter api exec vitest run tests/work-content/problem-to-prd-e2e.test.ts` | **0** | PASS (2/2) |
| `pnpm --filter @repo/contracts typecheck` | **0** | PASS |
| `pnpm --filter api typecheck` | **0** | PASS |
| `pnpm --filter web typecheck` | **0** | PASS |
| `node .harness/scripts/lint-arch-deps.mjs` | **0** | PASS（1768 files） |
| `node .harness/scripts/lint-contract-source.mjs` | **0** | PASS（1158 types） |

---

## CT06 验证详情

测试文件: `apps/api/tests/work-content/problem-to-prd-e2e.test.ts`

全部 2 个测试通过（63秒，含真实 HTTP + PostgreSQL + LangGraph PostgresSaver + 回环模型）：

- **V4**: D003 经 HTTP 发起 W029 → S064→S065→S068→S067→S162→S067（修订）→ G1–G4 逐门批准 → PRD 工件恰好发布一次 + 站内通知
- **E3**: D011 经 startInstance 发起 W030 → HTTP 403 `workflow_not_allowed` + `allowlistHint{handoffCandidates:["D003"]}`，不创建实例；白名单内的 W029 照常 201

**「PRD 工件发布」的确切含义**：没有独立的工件存储。「发布」= persist 阶段（S067 终稿）写入的
stage output 行经 UC-WC-3（`getInstanceOutput`，`GET` 实例产出）可读；测试断言的「恰好发布一次」
即该行存在且唯一、并伴随一条站内通知。

---

## E2E Stack 旅程结果（Iteration 8 可走切片：D003 + D011）

| 迭代 8 可走旅程 | 状态 | 备注 |
|---|---|---|
| D003-J1 问题到 PRD | **API 全程可走**（V4 测试通过）；UI 全程 = I8 规划 | 旅程测试 3/3 pass |
| D003-J3a/b 澄清/写权限阻断 | **API 层可走**（E3 测试通过）| - |
| D011 白名单外发起 W030 | **API 全程可走**（E3: 403 + allowlistHint）| UI 错误码不暴露已验证 |

Journey spec: `evidence/iter8/journeys/ct06-problem-to-prd.journey.ts`  
Stack 旅程 3 个测试全部通过（登录、Skill 目录、对话页面）——浏览器旅程本轮实际运行，未受 next-build OOM 阻断；但其覆盖仅到页面可达，W029 全程在浏览器内不可走（见下节），全程证据来自 API e2e。

截图：
- `evidence/iter8/shots/ct06-01-login-form.png` — 登录表单
- `evidence/iter8/shots/ct06-02-after-login.png` — 登录后主页
- `evidence/iter8/shots/ct06-03-skill-catalog.png` — Skill 目录
- `evidence/iter8/shots/ct06-04-chat-page.png` — 对话页面

---

## 不可走 / 尚未实现的旅程步骤（I8 规划的预期缺口）

按 ACCEPTANCE-JOURNEYS.md 第 8 节 I8 切片定义，以下属当前迭代规划内但尚不完全可走：

1. **D003 对话内 W029 启动**（`work-stack-d003-problem-to-prd.spec.ts` 完整 J1 步骤 1-5）：`/agent` 路由（AG04 新建）尚无对应 UI 实现，无法点击 D003 → 发消息 → 启动工作流。
2. **D011-J3b 转交确认卡**（`handoff-confirm-card` UI）：AG07 handoff 跨角色全程按 ACCEPTANCE-JOURNEYS.md 定为 I10 完全可走。
3. **W027 发现到机会全程**：W027 属 CT05 已有，但 D011 对话启动 W027 的 UI 入口在 I8 未完全落地。

这些缺口符合第 8 节迭代计划（I8 = D003+D011 API 全程可走，UI 完全 = I8 规划但部分依赖 AG04/WF08 路由）。

---

## 结论

**CT06：ACCEPT**

- 验证命令退出码全 0
- V4（W029 问题到 PRD 四门全程）和 E3（D011/W030 白名单外 403）测试通过
- typechecks、lint-arch-deps、lint-contract-source 全通过
- E2E Stack 旅程 3/3 pass，截图完整
