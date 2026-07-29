# 会话交接 — Sprint 00/01

## 当前已验证

- **F14 前端内核 = `passing`**（全项目第一个满足完成定义的 feature）。
  七条 verification 全过：`typecheck` / `lint:design` / `contrast` / `test` /
  `verify-ui-states.sh` / `verify-prod-gates.sh` / `e2e`。
  证据：`evidence/F14.verify.log`（已入库——doctor 要求证据**可追溯**，不只是落盘）。
- 全仓门控绿：`doctor --phase 00` 0 FAIL / 0 WARN；
  `validate-fl` 四阶段通过；`verify-uc-coverage` 覆盖矩阵完整；`verify:base` 通过。

## 本轮改动

1. **补上 ADR-020 声称存在但没做的 `new-sprint` 门控** →
   `.harness/scripts/lib/design-signoff.ts`。反证已验：契约束改回 `pending` 即拒绝开 sprint。
2. **修一个我自己埋的类型错**：harness 的 `Feature.evidence` 是 `string`，
   我在 `requirement-author` 规格里写成 `[]`，导致 224 个 feature 全带错类型
   （verify 写入字符串、被当数组读成 50 个单字符）。已修数据 + `validate-fl` + agent 规格。
3. **拆出 F18 后端内核**（见下）。

## 仍损坏或未验证

- **F01 已转 `blocked`**，挂在 F18 上。原因：它的三条 verification 指向的测试文件不存在，
  而它们所需的**后端本身不存在**（`apps/api` 无、零 NestJS、零迁移、零 PG 连接）。
- **F18 尚未进任何 sprint** —— 其契约束 `api-kernel` 待人类签核，
  `new-sprint` 会拒绝（已实测：`assertDesignSignedOff("00",["F18"])` 抛错）。
- **两处现存门控空洞**（F18 要补的，写在 `api-kernel/coverage.md` A-1 / A-2）：
  - `lint-arch-deps.mjs` 至今**从未扫过一个文件** —— 它对不存在的 `apps/api/src`
    打印「跳过」并 exit 0，而 ADR-020 称它「与七道门控同级、强制」。
  - `lint-contract-source.mjs` **只覆盖前端侧** —— 后端抄一份 DTO 不会有任何东西报警。
- **合规/法务四条问询未答**（`phases/requirements/COMPLIANCE-INQUIRY.md`）。
  Q-1 法定留存清单是**真阻塞**，卡住撤回删除相关 feature。

## 下一步最佳动作

**这是一个人类动作，不是 agent 动作**：

1. 读 `phases/phase-00-shared-kernel/contracts/api-kernel/design-signoff.md`
   （7 个确认项，其中 **A-4「后端不引入 ORM」** 决定 F01~F13 全部持久化代码的写法，很难回头）。
2. 读 `design-coherence.md` 第七节「修订 A」—— 第五个束加入后，
   **只有 X-3（出网为零）需要重新看**：它当时是**带着「无人认领」的缺口签过去的**。
3. 两处签完后：`pnpm harness new-sprint --phase 00 --id 02 --features F18`。

⚠ **不要动的东西**：
- `active-features.json`（脚本派生只读）
- 任何 `design-signoff.md` / `design-coherence.md` / `ui-signoff.md` 的 `status` 字段（人类专属）
- F14 的门控脚本 —— 它们是 UC-0.4 R8「V1–V10 无一依赖人工判断」的兑现物

## 命令

- 启动：`pnpm -w run dev`
- 验证：`pnpm harness verify --sprint 00/01`
- 体检：`pnpm harness doctor --phase 00`
- 清单校验：`pnpm exec tsx .harness/scripts/validate-fl.ts 00 01 02 03`
- 覆盖矩阵：`pnpm exec tsx .harness/scripts/verify-uc-coverage.ts 00`
- 依赖解锁（F18 passing 后）：`pnpm harness sweep-unblock`
