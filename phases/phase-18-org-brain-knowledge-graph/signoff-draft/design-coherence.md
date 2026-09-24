---
phase: "18"
# 本次一致性复核实际看过的束（ADR-023 决策四：声明集合 ⊇ 本阶段全部束）。
covers_bundles: [chat-knowledge-graph]
status: pending           # ⚠ 只能由人类改，agent 不许动
---

# Phase 18 阶段一致性复核

本阶段只有 `chat-knowledge-graph` 一个束，所以阶段内部不存在束与束之间的交叉约束。
本复核核对的是它与**已签的外部束**之间的边界：phase-00 `context-pack`，phase-01 `chat` / `chat-context-engine` / `files`。
每项先列事实，再给结论；逐项勾选确认是人类的动作。

## XC-01 · 可见性与所有者判定（vs phase-01 `chat`）

- [ ] 本束不定义第二套角色语义：会话可见性与所有者判定一律委托 `chat` 束 UC-0 / F108（`usecases.md` 统一约定）。
- [ ] L1 个人空间 = 同一用户全部 `private` 且无项目的个人线程（S0-2=A），不新建容器，不改 `chat_threads` 的 `project_id NOT NULL` 约束对项目线程的语义。

## XC-02 · 召回边界（vs phase-01 `chat-context-engine` 与 delta `personal-thread-own-attachment-recall`）

- [ ] 召回仍在 `ContextAssemblyPort` 内侧的 L3，`ModelCallPort` 不动，L1 / L2 不动。
- [ ] 已签 delta「个人对话只召回本线程自有附件、跨范围恒零」被放宽为「另外可召回本人个人空间中已确认晋升的知识」。放宽已由人类在 S0-3 同意（2026-09-24）。**实现时要在该 delta 下补一条 design-delta 记录这次放宽**，不能静默改写它。
- [ ] 跨用户、跨组织的召回仍然恒为零（I-11、I-14）。

## XC-03 · Context Pack 形状（vs phase-00 `context-pack`）

- [ ] `ClaimStatus` 直接复用，不建第二份（`knowledge-graph.ts` import 自 `context-pack.ts`）。
- [ ] `RetrievalChannel` 已包含 `graph` / `vector`，本束不新增通道枚举。
- [ ] **待拍板**：D-KG-1（通道不可用信号）与 D-KG-2（图路径字段）都会改 `context-pack` 束。拍板后走该束的 design-delta，本项才能勾选。

## XC-04 · 删除级联（vs phase-01 `files`，uc-22-4）

- [ ] 本束实现 `files` 束已声明的出站端口 `OUTBOUND_PORTS.invalidateOntologyEdges`，输入输出形状不改。
- [ ] 语义收敛：端口注释写的是「置 status=invalidated」，现状实现 `pg-deletion-repository.ts` 是按 segment 硬删。本束加上 `ontology_edges.status` 并改为软失效，与契约注释一致，消除这处「同一事实两处说法不一」。
- [ ] 5 分钟 SLA 引用 uc-22-4，本束不另写数字。

## XC-05 · 错误语义

- [ ] 本束错误码统一使用 `KG_` 前缀，不复用其他束的码名；相同的失败在本束内部只用一个码（晋升逐条拒绝码是 `KgErrorCode` 的子集，`extract` 出来，不另起名）。

## XC-06 · 架构（vs ADR-114 与 context-engine.md）

- [ ] AGE 只作可重建投影，只返回 id；权限判定只在 PG RLS 一处（I-11、I-12）。
- [ ] 检索仍是 hybrid，图只给加分（ADR-114 决策 6）。

## 人类确认动作

请先确认 `contracts/chat-knowledge-graph/design-signoff.md` 的 ① UI、② 用例、③ API 契约，以及〇节的 D-KG-1 / D-KG-2。
然后逐项确认 XC-01…XC-06。
只有人类可以把本文件和束级签核文件的 `status` 改为 `confirmed`，并填写 `confirmed_by`、`confirmed_at`。
