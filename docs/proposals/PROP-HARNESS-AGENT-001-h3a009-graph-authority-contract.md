# H3A-009 — Graph authority/projection contract

> Epic E0 收尾项。完成契约原文："Domain、Authorization、Workflow、Runtime、
> Telemetry writer/authority 明确且不可互相反写"。
>
> 本文件不是重新发明模型——§15"存储与权威边界"和 §9"四条权威边界"已经把
> 抽象规则写清楚了。本文件做的是把那份抽象表**落到这个仓库真实存在的系统
> 上**，逐条给出真实证据（H3A-002/005 的现场取值 + 本条目自己核实的部分），
> 并且用一次刚发生的真实事故（见文末）说明"权威不可反写"不是理论洁癖。

## 五类权威，逐条落到真实系统

| 类别 | 本仓真实权威系统 | 证据 | 允许的投影/派生视图 | 投影是否可反写权威 |
|---|---|---|---|---|
| **Domain**（业务领域模型：Feature/Contract/Invariant/Domain 边界） | Git（`phases/*/feature_list.json`、`packages/contracts/src/*.ts`、`docs/adr/`） | H3A-002 inventory：`registry.yaml`/`roles/*.yaml`/`ADR-010`/`coordinator-sop.md` 对同一 Domain 边界事实各写一份，是本类目前**唯一没有做到**"writer 单一"的地方——不是新发现，是把已知问题正式记录进本合同 | `.harness/state/dep-graph.md`（`pnpm harness dep-graph` 生成）、Graph Kernel 的 `GraphSnapshot`（`.harness/state/.cache/graph`） | 否——两者都已 gitignore（见下方"机械检查"），且都在各自文件头写明"可重建，不人工维护" |
| **Authorization**（谁能做什么：Role/权限矩阵） | Git（`.harness/agents/registry.yaml` 的 `agents:`/`reviewers:` 数组，header 自己写"改动走 PR review"） | H3A-004 实测踩过的真 bug：`registry.yaml` 有 `agents:`/`reviewers:` **两个**数组都是权威，漏读一个就会把真实登记的角色误判成"未登记"——这不是抽象风险，是这次真的把 `rev-feature`/`rev-e2e` 误报过 | `role-freeze doctor` 的扫描结果（H3A-004，运行时输出，不落盘） | 否——doctor 只读不写 |
| **Workflow**（任务怎么流动：Task Assignment/Workflow Event/Review Decision） | 目前**没有专门的运行时权威**——H3A-002 inventory 现场核实：GitHub issue/PR 评论是叙述层（人类可读投影），`.harness/state/*.json`（module-lock 等）是**运行时租约状态**，不是 Workflow 权威；H3A-030~037（Epic E3）尚未开工，"Task Assignment/Workflow Event 的 envelope 该落在哪"还没有答案 | 如实标注 UNKNOWN，不是遗漏——完成契约要求"明确"，这里明确的结论是"目前没有，等 Epic E3" | 无（还没有投影，因为还没有权威） | 不适用 |
| **Runtime**（Agent 运行实例身份/lease/claim） | coord-gateway（RepoHub Durable Object）——H3A-002 inventory + 本会话重建的 `ADR-017`：2026-07-18 起，`role:coord-main`/`module:<name>` 等租约的唯一跨机器权威在这里，不在 Git、不在 GitHub | `.harness/scripts/coordinator-lock.ts`/`module-lock.ts` 的头部注释、`ADR-017-coord-gateway-repohub-cutover.md`（本地重建） | `.harness/state/module-lock-*.json`（本地心跳缓存，非跨机器权威） | 否——这些文件本身已被 `.gitignore` 排除（`.harness/state/module-lock-*.json`），意图明确：不许把租约缓存当权威提交进 Git |
| **Telemetry**（可观测性：Trace/Span/Span Event） | **目前不存在**——本仓没有 OpenTelemetry 集成，proposal §2.3 TERM-OBS-\* 三个 Term ID 目前只是术语占位，没有对应的真实系统 | grep 全仓 `OpenTelemetry`/`opentelemetry` 零命中（本条目现场核实） | 不适用 | 不适用 |

## 机械检查：已知投影路径不得被 Git 追踪

"不可反写"里唯一现在就能自动判定的部分：**已知的、明确标注为"可重建投影"的路径，不能被 Git 追踪**——一旦被追踪，说明有人在编辑投影本身而不是编辑权威源，投影会漂移成第二份事实，正是本仓"同一事实不得声明在两处"反复踩过的坑的另一种形态。

`.harness/scripts/lib/graph-authority.ts` 定义已知投影路径清单（目前 4 条，全部已有 `.gitignore` 规则，本检查验证的是"规则真的挡住了"，不是重新发明规则）：

- `.harness/state/.cache/`（Graph Kernel `GraphSnapshot`）
- `.harness/state/dep-graph.md`（依赖图，从 `feature_list.json` 重生成）
- `**/active-features.json`（sprint 派生只读视图）
- `.harness/templates/instances/`（TPL-EVD-001 证据实例，HMV2-066/#641）

`pnpm harness graph-authority doctor`：对每条路径跑 `git ls-files`，任何一条返回非空结果（即被 Git 追踪）→ FAIL，报出具体被追踪的文件——这正是本仓自己的 `.gitignore` 保护失效时会发生的事（真实发生过一次，见下）。

## 这条合同不是纸面的：刚发生的真实事故

写这份合同的同一轮工作里，核实"main 是不是权威"时发现 **PR #641、#653 在 GitHub 上显示已合并，但内容完全不在 `origin/main` 上**（`git merge-base --is-ancestor` 实测确认）——很可能是 `git reset --hard` 把 main（本仓 Domain/Authorization 权威的实际载体）强制指回了一个更早的 ref，而这类操作不会被任何东西自动挡住或自动通知。已通过 PR #677 找回。

这次事故不是"Graph 投影反写权威"，是**权威本身被意外回退**——但结论相同：**任何一类权威，只要它的"当前状态"可以被一个操作（`git reset --hard`、手改 registry.yaml 数组、手改 `.harness/state/.cache/` 里的快照）覆盖而没有人看见，这类权威就是不可信的**。本条目机械检查覆盖的是"投影反写权威"这一种具体形态；"权威本身被静默回退"这一种（今天真发生的这次）不在本条目范围内，留给未来的 `pnpm harness doctor` 或部署管线补一条"push 前置 fast-forward-only 检查"——如实标注，不假装本条目已经覆盖了它。
