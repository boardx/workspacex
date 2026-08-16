---
phase: "03"
# 本次一致性复核**实际看过**哪些束（ADR-023 决策四）。
# ⚠ 门控要求：声明的束集合 ⊇ 本阶段全部束。磁盘上现有的束只有 feedback-loop
#   （phase-03 此前没有 contracts/ 目录，本文件与该束同时建立）。
#   **新增束必须同时加进这里并重做复核**——否则新束的 feature 会靠一份从没看过它们的
#   复核解锁开工（ADR-023 背景 1 的原样复现）。
covers_bundles: [feedback-loop]
status: confirmed
confirmed_by: "usamshen（本会话口头授权，由 agent 代转录；人类原话：「以上的两个问题，同意，请继续」）"
confirmed_at: "2026-08-15T23:47:59Z"
---

# phase-03 阶段一致性复核

> **这一件回答的问题**：单束都签了，**它们之间打不打架？**
> 单束复核看不到跨束的交叉约束——一个束在自己的文档里说得通的规则，
> 可能与另一个束已签核的规则相反。
>
> ⚠ 本文件的 `status` 归人类所有——**agent 不得改**（ADR-023）。

## 0. 本次复核的范围

phase-03 今天磁盘上**只有一个束**：`feedback-loop`（2026-08-15 建，覆盖 FB-2/FB-3）。

⚠ **一个束的阶段做「一致性复核」看起来像走过场，但它不是**，理由有二：

1. `feedback-loop` 与**别的 phase 已签核的束**有真实交叉（见第 1 节），
   而那些交叉正是最容易出事的地方——本阶段内部没有第二个束来打架，
   跨阶段却有三处。
2. phase-03 的 `feature_list.json` 里有 **49 条 feature，其中 47 条没有任何契约束**
   （F01…F47 全部 `not_started`，且 `contracts/` 下没有它们的束）。
   本次复核**没有覆盖它们**——那 47 条开工前必须先有各自的束并重做本复核。
   把这句话写在这里，是为了让「covers_bundles 里只有一个束」不被读成
   「phase-03 的设计已经复核完了」。

## 1. 跨束 / 跨阶段交叉约束

| 编号 | 交叉点 | 对面是谁 | 现状 |
|---|---|---|---|
| X-F1 | 「反馈」这件事的**两条来源**：人主动提的（本束）vs 消息级 👍/👎 聚合的（`skills` 束 F68） | phase-01 `skills`（已签核） | ✅ 已划清：本束不重新声明那九条操作；`getFeedbackCounts` 与 `getLoopMetrics` 口径不同且不重叠。**待人类复核这条划分是否是他想要的** |
| X-F2 | 反馈**不进满意度**（I-F3）与 `skills` 的 O-37 满意度口径 `👍/(👍+👎)` | phase-01 `skills`（已签核） | ✅ 结构性保证：本束五条操作没有任何一条读写 `message_ratings` |
| X-F3 | 正文可见性（D3）借用 `identity` 束的 `PermissionReason` 闭集 | phase-00 `identity`（已签核） | ✅ 借 `ORG_SCOPE_DENIED`，**不新造第 9 个值**（新造 = 实现期改一份已签核契约） |
| X-F4 | 后台反馈屏与 `skill` 屏画同一件事 | phase-01 `skills`（已签核的 UI 材料含 `skill-feedback` 那块屏） | ⚠ **D1 已裁：后台屏唯一入口，skill 屏降级为链接**。这意味着 `skills` 束已签核的 UI 材料里有一块屏被本次改动降级了——**这一条需要人类在复核时确认**：改一块已签核束的屏，是否需要 `skills` 束重签 |
| X-F5 | 导航图标栏新增一个**动作型**入口（不是路由） | phase-01 全部束的导航可达性门控 | ✅ 不进 `NAV_SEGMENTS`，因此 `lint-nav-reachability` 不要求它对应束路由；实测该门控仍绿 |

## 2. 复核结果（2026-08-15）

`status: confirmed`。签核方式：**人类在会话里口头授权，由 agent 代转录**——
原话逐字「以上的两个问题，同意，请继续」。同
`contracts/feedback-loop/design-signoff.md` 的说明：`confirmed_by` 明写
「由 agent 代转录」，与人类自己敲名字的形态在审计上**不等价**。

### X-F4 的处置：`skills` 束**不**重签

判据是这次改动**没有动那个束的契约与用例**。`skill-feedback.tsx` 那块屏画的三样东西
（改进建议 / 闭环度量 / 提案 diff）在 `skills` 束里是 `listSuggestions` /
`getLoopMetrics` / 提案三步的**界面投影**，而那三条操作**全仓零实现**——
被降级的是一块从未接过后端的示例屏，不是那个束里任何一条已经成立的行为。

⚠ 这条判据有边界，写下来免得以后被当成通例：**它只在「被降级的屏没有真实后端」时成立**。
   哪天 `listSuggestions` 落了地，那块聚合区要加**回** `/admin/feedback`（见 §3），
   届时动的是 `skills` 束真实存在的行为，就必须那个束重签。

## 3. 仍然没做的（`status: confirmed` **不覆盖**这些）

- **47 条无束 feature 未复核**（见第 0 节第 2 点）。本次复核只看了 `feedback-loop`
  一个束；F01…F47 开工前必须先有各自的束并**重做本复核**。
  ⚠ 不要把本文件的 `confirmed` 读成「phase-03 的设计已经复核完了」。
- **聚合建议那一块的归宿**：`skills.listSuggestions` 落地后，它加在 `/admin/feedback`
  这块屏上，**不是再开一块屏**——两块屏画同一件事正是 D1 要消除的东西。
