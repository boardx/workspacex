# contracts-pending/ —— 已写好、等人类一致性复核后搬进 `contracts/` 的契约束

> **这不是第二个 `contracts/`。** 这里的目录**不被任何门控读取**（`design-signoff.ts` /
> `lint-ui-material` / `lint-third-artifact` / `dashboard` 都只认 `contracts/`），它存在的
> 唯一理由是下面这条机械事实：

`contracts/` 下每多一个束目录，`auditSignoff`（`.harness/scripts/lib/design-signoff.ts`）就要求
`design-coherence.md` 的 `covers_bundles` 覆盖它——否则 `pnpm harness doctor --strict`
FAIL（backend-gates CI 红）。而 `covers_bundles` 与 `status` 一样归人类所有（ADR-023：
「不要只改 covers_bundles，那是把『没复核』谎报成『复核过』」）。所以 agent 能做的止于
「把五件材料写好放在这里」，搬进 `contracts/` 必须与人类重做阶段一致性复核是**同一次动作**。

UC-17.8 B6.2（2026-09-05）把 `inbox-unified` / `feedback-drafts` 两束的五件材料写在这里。
`ui-material-map.json` / `third-artifact-map.json` / `nav-reachability.config.json` 三处映射
已提前登记（对不存在的束不生效也不报错）；搬进去之后三道 lint 不需要再改——已在本地
临时放进 `contracts/` 验证过全绿（见 PR 正文）。

## 人类要做的一次动作

1. 读两束 `design-signoff.md`（各自 ① ② ③ 三节 + 「补签」段），决定签还是退回。
2. 重做 `design-coherence.md` 的交叉约束复核（新增束与 `feedback-loop` / `design-workbench` /
   `system-error-logs` 的交叉点在两束 `domain.md` 末节列出来了），把 `covers_bundles` 补成
   `[design-workbench, feedback-drafts, feedback-loop, inbox-unified]`。
3. `git mv phases/phase-03-reuse-and-governance/contracts-pending/{inbox-unified,feedback-drafts} phases/phase-03-reuse-and-governance/contracts/`，
   删掉本目录。

搬完之后 `pnpm harness doctor --phase 03 --strict` 应只剩两束 `status: pending` 的签核提示，
没有其它红。
