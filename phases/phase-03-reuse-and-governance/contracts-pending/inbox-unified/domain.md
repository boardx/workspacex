# 契约束 `inbox-unified` — 领域模型

> 支撑材料（ADR-023 决策二：不在签核面里，不得删除）。内容整理自
> `packages/contracts/src/inbox.ts` 文件头 + `application/inbox/*.ts` 文件头，不新增产品决策。

## 1. 实体：**没有**——收件箱是投影，不是存储

| 来源 | 表 | 归属束 | 收件箱里的 `kind` |
|---|---|---|---|
| 反馈 | `product_feedback` | `feedback-loop` | `feedback` |
| 系统异常 | `error_logs`（+ B3.3 `system_error_status_events`） | `system-error-logs`（phase-14 `error-observability`） | `exception` |
| 设计方案 | `design_projects`（`pushed = true` 的行） | `design-workbench` | `design` |

`InboxItem` 是三张表的**只读投影**：一个 shape 服务三种来源，差异靠 `kind` + 「仅某类非 null」
的字段表达（字段一览表在契约 `InboxItem` 头注，这里不复制）。本束**没有自己的表、没有自己的
迁移**——B3.3 的 `system_error_status_events` 表归 `system-error-logs` 束（形状同
`product_feedback_status_events`），收件箱只读它。

## 2. 四列 `stage` 是派生值，映射表只有一份

`InboxStage = backlog | doing | done | archived` 不落库。源状态 → stage 的映射表**只在契约
文件头声明一次**，实现只有 `stageOf()` 一处，api 与 web 都只许调它（`lint-contract-source`
抓手写副本）。本文件不再抄一遍那张表——抄了就是第二份事实。

不变量：
- `exception` 没有 `done`（`SystemErrorStatus` 三态）——看板把系统异常拖进「已完成」列时
  **没有**可调的迁移，前端按钮必须不存在。
- `已归档` 与 `不做` 共用 `archived` 列（issue #2681）——共享显示位置，不是合并状态。
- `design` 恒 `backlog`（设计项目没有状态机，`pushed` 是它唯一的二态，见
  `design-workbench/domain.md` §1）。

## 3. 展示编号 `code`

`B-n` / `R-n` / `E-n` / `D-n`，`n` = 同前缀在该 org 内按 `createdAt`（同刻按 id）的
`ROW_NUMBER()`，**不新增列**。系统异常没有 org，按全平台顺序。只做展示与搜索，跳转一律用 `id`。

## 4. 可见性：两道门，分别归属两个束

1. **整条收件箱**：**本组织任何成员**可读；只对「不是本组织成员」`PERMISSION_REVOKED`
   （D8 ③，2026-09-05 人类裁决——B3.2 曾收紧到 `canTriage`，B3.6 替换旧屏后那道门把已签核的
   D3「标题+票数全组织可见」收回去了，非管理员提交后被导到 403）。分诊/投票/深化各自的
   契约操作各自判权限（`triageFeedback` 仍 `canTriage`），本束不替它们放行。
2. **系统异常那一半**：请求者必须是平台超管（`isRequestorPlatformOperator`）。不是超管
   ⇒ **不报错，只是不含**：`sources.exception: "withheld"`，`byKind.exception = 0`。
   `withheld` = 那一半根本没被查询，不是查了为空。
3. 反馈正文 / 提交人显示名沿用 `feedback-loop` 的 D3 门控（`body === null` ⟺ 无权看，
   不是正文为空）；`q` 只搜 `title` 与 `code`，**不搜正文**——按无权看的内容过滤会泄露
   「有没有」。

## 5. 分页：应用层 keyset，不是一条能下推到数据库的游标

`error_logs` 只有 `app_diag_ro` 能读，`product_feedback` 走 `app_rw` + RLS——两张表不在同一
个会话模型里，不能 JOIN。聚合层复用 `listFeedback`（不分页，"一周几十条"）与 `ErrorLogPort.list`
（分页，受 `INBOX_EXCEPTION_FETCH_CAP = 2000` 上限），内存归并后按
`createdAt` 倒序、同刻 `kind` + `id` 切页；`cursor` 是服务端签发的不透明串。

**已知取舍**：每次请求重新拉两源再排序。B6.4 起 `aggregate-inbox-sources.ts` 每次聚合记
一条结构化日志（三源行数、各源耗时、`exceptionCapHit`、withheld、返回条数），取舍的边界
被碰到时值班可见。

## 6. `severe` 与 `github` 的派生（服务端单一实现）

- `severe`：系统异常 `exception.count >= INBOX_EXCEPTION_SEVERE_COUNT_THRESHOLD`（同一条 `msg`
  的出现次数）；反馈恒 `false`（没有标签）。
- `github`：反馈按**存下来的** `githubIssueUrl/Number` + `sourceStatus` 推 issue 开关
  （`已修复/不做/已归档 ⇒ closed`），列表**不打 GitHub**；drawer 展开后前端现查
  `getFeedbackGithubIssue` 升级为 PR 徽标（`merged > open > closed`）。系统异常/设计方案恒 `null`。

## 7. 与 R4.3 原文的偏离（契约落地时改过口径的地方）

| R4.3 原文 | 契约现状 | 理由 |
|---|---|---|
| GitHub 徽标随机编号模拟 | 读真实 `triageFeedback` 建的 issue | R1 已真建 issue，不退回模拟 |
| `severe` 由标签或 level=error 派生 | 只看次数 | 反馈无标签；`error_logs` 无 `level` 列（每行本来就是一次未处理异常） |
| 类型 chip 5 项 | 4 项（缺陷/需求并成「反馈」） | UI 先行决定 2，待确认 |
| `PUT /inbox/:id/status` | 不存在 | 同一状态机多一个入口 = 两份错误码映射迟早对不上 |

## 8. 跨束交叉点（给阶段一致性复核用）

- **`feedback-loop`**：D2 = 替换旧三 tab 屏，B3.6（#2714）已退役旧屏并 301，该束需重签；`triageFeedback` 的
  `issueDraft` 编辑器被本束复用；D3 门控原样透传。
- **`system-error-logs`（phase-14 `error-observability`）**：B3.3 给它加了状态事件表；
  本束不为系统异常发明「已修复」。
- **`design-workbench`**：`design` 条目是 `design_projects.pushed` 的投影；`linkedFeedbackId` /
  `resolvedByDesignId` 是同一对外键的两个读投影（`design-workbench/domain.md` §2）。
