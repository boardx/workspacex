# 进度日志 — Sprint 00/01

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: `pnpm -w run verify:base`
- 当前最高优先级未完成功能: <feature id / title>
- 当前 blocker: <无 / 描述>

## 会话记录
### 2026-07-28 16:53:35
- 本轮目标:
- 已完成:
- 运行过的验证:
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题:
- 下一步最佳动作:

### 2026-07-29
- 本轮目标：起第一个 sprint，跑通 verify→证据→passing；开工 F01。
- 已完成：
  - 补上 ADR-020 声称存在但**只写没做**的 `new-sprint` 设计签核门控
    （`.harness/scripts/lib/design-signoff.ts`），并造反证验证它真的会拒。
  - **F14 = passing**（七条 verification 全过），全项目第一个满足完成定义的 feature。
  - 修正 `Feature.evidence` 类型错（224 个 feature，根因是我写 agent 规格前没查 harness 自己的类型）。
  - **F01 未开工，转 `blocked`**：核实发现它的后端前提完全不存在。拆出 **F18 后端内核**
    （UC-0.6，13 点，契约束 `api-kernel`）——理由与 UC-0.4 拆出前端内核相同。
- 运行过的验证：`harness verify --sprint 00/01 --feature F14`（7 条）·
  `doctor --phase 00`（0 FAIL / 0 WARN）· `validate-fl 00 01 02 03` · `verify-uc-coverage 00` ·
  `verify:base`（9 tasks）
- 已记录证据：`evidence/F14.verify.log`（已入库）
- 已知风险或未解决问题：
  - `lint-arch-deps` 至今空转（对不存在的 `apps/api/src` 打印「跳过」并 exit 0），
    ADR-020 却称它「强制」——这是本项目第六次「门控看起来在跑其实没在测」。
  - `lint-contract-source` 只覆盖前端侧，ADR-020 的「zod → 后端 DTO」这一端从未被门控。
  - 合规/法务 Q-1（法定留存清单）仍是真阻塞。
- 下一步最佳动作：**人类签 `contracts/api-kernel/design-signoff.md`**
  （重点：A-4 后端是否引入 ORM、A-5 X-3 出网为零的归属），
  并复看 `design-coherence.md` 第七节「修订 A」。之后
  `pnpm harness new-sprint --phase 00 --id 02 --features F18`。
