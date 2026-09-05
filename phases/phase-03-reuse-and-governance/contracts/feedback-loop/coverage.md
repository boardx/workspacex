# 契约束 `feedback-loop` — 支撑材料②：UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 只要有一条验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：**FB-2 FB-3**
> ⚠ **这一行是派生视图，不是权威。** 束↔feature 映射的权威是 `design-signoff.md`
> frontmatter 的 `covers:`（ADR-023 决策三）。
>
> 验收线索来源：`usecases.md` 的 **V1–V12**（12 条）。

## 怎么读这些表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid`（已在仓库中核实）。

已建成并可引用的三处：
`/platform-admin/inbox`（`components/design-loop/inbox-screen.tsx`，
`inbox-*` 系列 testid）·
反馈弹层（`components/feedback/feedback-dialog.tsx`，由图标栏 / 顶栏 / chat 三处触发）·
`/chat`（`chat-live-message-panel.tsx` 消息头 · `chat-skill-mount-panel.tsx` 挂载 chip）。

⚠ **B3.6（2026-09-04，旧屏退役）**：下表 V7/V8/V10/V11 原来的「前端消费点」列填的是
`admin-feedback-*`（旧 `components/admin/feedback-screen.tsx` 的 testid 前缀）——该文件
已删除，这些 testid 已随之从仓库消失。下表已把这几行改成新屏 `inbox-*` 的 testid；
**V8/V9（投票）例外**——`inbox-screen.tsx` 的 drawer 只把票数当只读元信息展示，没有
`voteFeedback` 的界面入口（见 `ui.md` 屏 D 一节），所以 V8/V9 的「前端消费点」列改填
「无（API 仍在，界面入口已退役）」，状态从 ✅ 降级为 ⚠，登记为已知限制，不是隐藏
掉一条曾经覆盖的线索。`inbox-unified` 范畴今天还没有独立的 `coverage.md`（该范畴的
契约束尚待走 ADR-023 签核），本文件先把这条事实记在这里，避免"同一 UC 覆盖两处
声明不一致"。

---

## 一、UC → API（R12 验收线索 V1–V12）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 提交人 / 状态 / 创建时间由服务端定，不入参 | `submitFeedback.in` 无这三个字段（`.strict()`）；`FeedbackController.submit` 取 `principal.userId` | `feedback-submit`（请求体六字段，`feedback-dialog.test.tsx` ① 按实际请求断言） | ✅ |
| V2 | 复现上下文分列存，客户端给 | `submitFeedback.in.occurredRoute` / `.appVersion` | `feedback-context-notice`（屏上明写收集了什么） | ✅ |
| V3 | 提交失败明说没保存，不切标签页 | —（错误信封 `DEPENDENCY_UNAVAILABLE`） | `feedback-submit-error` | ✅ |
| V4 | 目标传真实 id 不是显示名 | `FeedbackTarget`（判别联合） | `chat-agent-feedback` / `chat-skill-feedback-{skillId}` | ✅ |
| V5 | skill 目标不带版本 | `FeedbackTarget` 的 `skill` 分支只有 `skillId` | 同上 | ✅ |
| V6 | 文字反馈不进满意度 | **结构性**：本束五条操作没有任何一条读写 `message_ratings` | —（API 层验收：`product-feedback-persistence.test.ts` 只触本束三张表） | ✅ |
| V7 | 标题+票数全组织可见，正文仅管理员与提交人 | `FeedbackItem.detail: nullable`；`decideFeedbackDetailVisibility` + `discloseDecided` | `inbox-drawer-body-withheld`（B3.6 前是 `admin-feedback-detail-withheld-{id}`） | ✅ |
| V8 | 票数 `COUNT(*)`、幂等、可撤 | `voteFeedback` | 无（界面入口已随 B3.6 旧屏退役，API 仍在） | ⚠ **见 B3.6 注** |
| V9 | 提交人可投自己那条 | `voteFeedback`（无自投禁止） | 同上 | ⚠ **见 B3.6 注** |
| V10 | 状态机四态；`已修复 → 不做` 不是边 | `triageFeedback` → `ILLEGAL_TRANSITION`（422） | `inbox-action-{start,done,back,reopen,decline}`（只出得去的边才有按钮，B3.6 前是 `admin-feedback-to-{status}-{id}`） | ✅ |
| V11 | 状态变更 append-only 留痕 | `triageFeedback` 落 `product_feedback_status_events` | `inbox-drawer-timeline`（B3.6 前尚无查看界面，见下方「缺口 1」历史；`inbox-screen.tsx` 已把它补上） | ✅ |
| V12 | 本体除状态两列外不可改 | **结构性**：本束没有任何「编辑反馈」操作 | —（API 层验收：`fb2_product_feedback_immutable_columns` 触发器） | ✅ |

### 缺口 1（历史）· 状态流水没有查看界面 —— B3.6 起已由 `inbox-unified` 界面补上

留痕一直在写（`product_feedback_status_events`，append-only，
`product-feedback-persistence.test.ts` ④ 两层各验一次）。这条缺口在旧
`feedback-screen.tsx` 时代是真实的：那块屏没有任何地方显示它，只能直连库查。

⚠ **2026-09-04（B3.6，旧屏退役）起不再是缺口**：接它的操作一直是本束已有的
`listFeedbackStatusEvents`（不是新增契约，此前只是没有界面消费它）；替代旧屏的
`/platform-admin/inbox`（`inbox-screen.tsx`「时间线」区块，`inbox-drawer-timeline`）
已经在消费这条操作。上面 V11 因此从 ⚠ 改判 ✅。这一段作为历史记录保留，不删——
如实记录"这条缺口曾经存在、什么时候、被什么补上"比事后抹掉更诚实。

---

## 二、API → UC（反向：有没有多余的接口）

| API 操作 | 被哪条 V 要求 | 结论 |
|---|---|---|
| `submitFeedback` | V1 V2 V3 V4 V5 | 必需 |
| `listFeedback` | V7 V8（`votedByMe`）；UC-F1 步骤 6「我提过的」 | 必需 |
| `voteFeedback` | V8 V9 | 必需 |
| `triageFeedback` | V10 V11 | 必需 |
| `getFeedbackCounts` | UC-F4 步骤 2（一次查询派生的状态分布） | 必需 |

**没有多余的操作。** 五条操作各自被至少一条验收线索要求。

⚠ 反向检查同时确认了**没有为「点了没反应的按钮」留接口**：
`[打开迭代看板]` / `[导出]` / 附件上传三者在本束里既没有操作，界面上也没有按钮。

---

## 三、与 `skills` 束（F68，已签核）的交叉检查

| 事实 | 在哪个束 | 本束是否重复声明 |
|---|---|---|
| `rateMessage` / `getSatisfaction` | `skills` | 否 |
| `listSuggestions` / `getLoopMetrics` / 提案三步 | `skills` | 否 |
| `PermissionReason` 枚举 | `identity`（phase-00） | 否（借 `ORG_SCOPE_DENIED`，不新造第 9 个值） |

⚠ `/admin/feedback` 一块屏吃**两个契约束**（左右两列各一个来源）是刻意的。
今天右列只有本束的数据；`skills.listSuggestions` 落地后，那块聚合区是**加在这块屏上**，
不是再开一块屏——两块屏画同一件事正是 D1 要消除的东西。
