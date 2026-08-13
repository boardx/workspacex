# PROP-FEEDBACK-LOOP-E2E-001 — 反馈与迭代闭环端到端方案

状态：待裁决（人类要求：把「反馈与迭代」从测试数据做成端到端）
提出：2026-08-14（dev-org-admin）
实测基线：`origin/main@8cf89fad`
相关：UC-17.6（反馈与迭代闭环）、UC-3.6 / F68（Skill 改进反馈，**已标 passing**）、ADR-023

---

## 0. 一句话结论

**这件事已经做了一半，但那一半是「悬空的」**：F68 把 Agent/Skill 改进闭环的**契约与判定逻辑**做完并标了
`passing`，却**没有表、没有路由、没有前端**——它的四条验证全是内存 fake。
另一半（软件反馈）**契约都还没有**。

所以方案不是「从零做一个模块」，而是**把已有的一半接到地面上，再补另一半**。

---

## 1. 现状（逐条实测，`origin/main@8cf89fad`）

### 1.1 Agent / Skill 侧 —— 契约齐全、逻辑齐全、**地基全无**

`packages/contracts/src/skills.ts` 第六节「改进反馈与版本触发（F68）」已有 **9 条操作**：

| 操作 | 契约 | application 用例 | 仓储实现 | 迁移表 | HTTP 路由 | 前端 |
|---|---|---|---|---|---|---|
| `rateMessage` | ✅ | ✅ `rate-message.ts` | ❌ | ❌ | ❌ | ❌ |
| `getSatisfaction` | ✅ | ✅ `get-satisfaction.ts` | ❌ | ❌ | ❌ | ❌ |
| `listSuggestions` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `classifySuggestion` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `listSuggestionCases` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `generateImprovementProposal` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `editProposal` / `reviewProposal` | ✅ | ✅ `review-proposal.ts` | ❌ | ❌ | ❌ | ❌ |
| `getLoopMetrics` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

证据：
- `RatingRepositoryPort` 在全仓只出现两处（`application/skill/ports.ts` 声明 + `rate-message.ts` 引用），
  **`infrastructure/skill/` 下没有任何实现**（该目录只有 contract/starter/url-import/thread-mount 四类仓储）；
- `apps/api/migrations/` 里 **grep `message_rating` / `skill_suggestion` / `improvement_proposal` 零命中**；
- `skill.controller.ts` 自己写着（第 99 行）：
  > `satisfaction`：👍/👎 评价（F68 `rateMessage`）**不在 #459 范围内**
- F68 的四条 verification 全在 `tests/capability/skill/`，**没有一条 import `PgDatabase` 或 `migrateOnce`**
  ——纯内存 fake。

⚠ **这不是指责 F68 造假**。它的 `user_visible_behavior` 说的是聚合与归因的判定，那部分确实被验证了。
但「完成定义」第 1 条要求「行为真实可见、端到端可复现」——**这一条它没到**，而 `passing` 让人以为到了。
本提案不改 F68 的状态（那不是我能动的），但把这个缺口写在这里，作为方案的起点。

### 1.2 软件反馈侧 —— 什么都没有

契约 0、用例 0、表 0。（我 2026-08-12 提的 `feedback-loop` 束里有 domain.md 提案，
**已随 #1065 撤回**——它触发了三道束级门：截图索引 / ③件契约文件 / R12 覆盖矩阵。）

### 1.3 前端 —— 两块 mock 屏在画同一件事

| 屏 | 文件 | 数据源 | 问题 |
|---|---|---|---|
| 后台 · 反馈与迭代 | `components/admin/feedback-screen.tsx`（178 行） | `lib/mock/admin` | 全 mock + `NoBackendNotice` |
| Skill · 改进反馈 | `components/skill/skill-feedback.tsx` | `lib/mock/skill`（`FEEDBACK_AGGS` / `FEEDBACK_LOOP` / `PROPOSAL_DIFF`） | 同上 |

⚠ **同一件事在两块屏上各画了一遍**——「同一事实两处声明」的界面版。
两块屏都渲染「改进建议 + 闭环度量 + 提案 diff」，而它们迟早会不一致。
**这是本方案要人类裁的第一件事**（见 §4-D1）。

### 1.4 采集入口 —— 一个都没有

- chat 的 `ai-message.tsx`：**grep `ThumbsUp` / `ThumbsDown` / `rating` 零命中**，AI 消息上没有任何评价入口；
- 全局导航（`shell/top-bar.tsx` + `shell/icon-rail.tsx`）：没有「提反馈」入口。

⇒ 即使后端全通，**今天也没有任何一条真实反馈能进入系统**。这是整件事最靠前的堵点。

---

## 2. 方案：四条 feature，按依赖顺序

```
FB-1 消息级评价落地  ──┐
   （表+仓储+路由+chat 图标）│
                          ├──> FB-3 后台两列屏真栈化
FB-2 软件反馈采集     ──┘         （左列=FB-2，右列=FB-1 聚合）
   （表+路由+Nav 入口）
                                    └──> FB-4 改进 PR 三步闭环（可后置）
```

### FB-1 消息级评价落地 —— 把 F68 接到地面

**用户可见行为**：在 chat 里对任意一条 AI 消息点 👍/👎（可选填一句原因），
该评价立即落库并归因到**这条消息实际用的 agent 版本 + skill 版本**；同一个人对同一条消息
重复点只算一次；归因缺失时评价仍然保存，但**不计入任何 skill 满意度**并进数据质量报表。

- **新增**：`message_ratings` 表（`(message_id, rater_id)` 唯一键 = 契约 V13 的幂等键）、
  `PgRatingRepository`、`POST /messages/:messageId/rating` 路由。
- **不新增契约**：`rateMessage` 的形状 F68 已定并签核过，本条只补它的地基。
- **前端**：`ai-message.tsx` 加一对 👍/👎 图标（hover 显形，点后固化），
  👎 展开一行可选原因输入。
- ⚠ **归因数据从哪来**：`agent_runs` 有 `agent_version_id` / `skill_version_ids`，
  消息经 `chat_messages.agent_run_id` 关联——**归因是查出来的，不是前端传的**
  （前端传归因 = 用户可以伪造某个 skill 的满意度）。

### FB-2 软件反馈采集 —— Nav Bar 入口 + 后端

**用户可见行为**：任何页面点导航上的「反馈」图标 → 弹层填「缺陷 / 需求」+ 标题 + 描述（可附件）→
提交后进入待处理队列；反馈**自动带上发生位置（当前路由）、应用版本、提交人**，
提交人能在同一个弹层里看到自己提过的反馈及其状态；别人的反馈可投票。

- **新增**：`software_feedback` + `software_feedback_vote` 表、契约操作
  （`submitSoftwareFeedback` / `voteSoftwareFeedback` / `listSoftwareFeedback` / `triageSoftwareFeedback`）、
  `SoftwareFeedbackController`。
- **前端入口放哪**：`shell/icon-rail.tsx`（左侧图标栏，≥md 常驻）+ `shell/top-bar.tsx`（<md 时）
  —— 与 `org-menu` 同一处置，避免小屏丢入口。
- ⚠ **复现上下文三列各一列，不是一个 jsonb 口袋**：`occurred_route` / `app_version` / `submitted_by`。
  一个「什么都能塞」的 jsonb 到排查时什么都查不到。
- ⚠ **票数是 `COUNT(*)`，不存 `vote_count` 列**——那会立刻变成第二份可能对不上的事实。

### FB-3 后台两列屏真栈化 —— 按第二张参考图重排

**用户可见行为**：`/admin/feedback` 变成两列——左列「软件反馈」（真数据，含类型徽标/票数/状态/
`[推送到开发 Agent]`），右列「Agent / Skill 改进反馈」（真数据，含 👎 数 / 案例数 / 具体改动建议 /
`[生成 skill 改进 PR]` / `[看 N 个原始案例]`），右下「迭代闭环」度量条（N 条 → M 条 PR → K 条上线）。
零反馈时是空态，不是示例数据；`NoBackendNotice` 摘除。

- 左列 = FB-2 的数据；右列 = FB-1 落库后由 `listSuggestions` 聚合出来的数据。
- **闭环度量四个数必须同源**（一次查询派生），不是四处各查各的。
- ⚠ **`[打开迭代看板]` / `[导出]` 建议这一版删掉**：UC-17.6 的 A1/A2 逐字写着
  「按钮存在，但点击后无目标屏（原型待补）」。留一个点了会出现「实现者自己设计的看板」的按钮，
  比没有按钮更糟——它会被当成已确认的设计继续长。

### FB-4 改进 PR 三步闭环（建议后置到下一轮）

`generateImprovementProposal → reviewProposal（人工）→ 灰度`，三步不可颠倒、不可跳过；
开发 Agent 不得自行上线；驳回/回滚理由 append-only。

**为什么后置**：F68 的 application 层已有 `generate-improvement-proposal.ts` / `review-proposal.ts` /
`release-proposal.ts`，补地基的工作量与 FB-1 同量级；但**没有前三条，它没有输入**——
没有评价就没有建议，没有建议就没有 PR。先让水流起来。

---

## 3. 先决条件：契约束签核（这一步绕不过）

FB-1~FB-4 都落在 phase-03 的 `feedback-loop` 束里，而**那个束的材料已被 #1065 撤回**。
重提时必须同时满足三道束级门（这三道是 2026-08-12 实测撞出来的）：

1. **`ui.md` 的截图材料被索引**：`phases/phase-03-*/ui-preview/feedback-loop/` 目前**整个不存在**，
   要由 ui-prototyper 把三块屏（后台两列屏 / Nav 提交弹层 / chat 消息评价）截出来，
   并在 `.harness/scripts/ui-material-map.json` 里声明；
2. **第 ③ 件**：`packages/contracts/src/feedback-loop.ts`（软件反馈那半边的契约文件）；
   Agent/Skill 那半边**复用 `skills.ts` 已签核的九条操作，不重新声明**；
3. **`coverage.md` 用 R12 编号为行键**的映射表。

---

## 4. 请人类裁的五件

- **D1（最重要）· 两块 mock 屏怎么收敛**：`admin/feedback-screen.tsx` 与 `skill/skill-feedback.tsx`
  今天画的是同一件事。建议：**后台屏是唯一入口**（它已在左栏 IA 里，UC-17.6 的归属也在那儿），
  `skill-feedback.tsx` 降级为「从 skill 详情跳到后台屏的一个链接」——同 F160 对
  「组织成员」屏的处置。若人类要保留两块，必须裁清楚各自看什么，否则它们必然漂移。
- **D2 · Nav 入口的形态**：图标栏常驻图标（我的建议）还是顶栏下拉里的一项？
  常驻的代价是占一个槽位，收益是「随时能提」——而反馈这件事一旦要多点两下就没人提了。
- **D3 · 谁能看到别人反馈的全文**：UC-17.6 R5 自己标着 `[待确认]`。
  它直接决定 `listSoftwareFeedback` 回不回 `body` / `attachments`。
- **D4 · 附件**：UC 的原型里有「附了 40 秒音频片段」。附件涉及 E2 的脱敏阻断（含客户数据的附件
  推给开发 Agent 前必须脱敏）。建议**第一版不做附件**，只做文字 + 自动上下文，
  把附件连同脱敏一起放到 FB-4 之后。
- **D5 · 「人工复核人」角色**：本产品的角色本体里没有这个值。建议复用「管理员 ∧ 非发起人」
  （同 F11 双人复核的形状），不新增组织角色——那要动 phase-00 的 identity 束。

---

## 5. 我建议的执行顺序与理由

1. **先 FB-1**，因为它把一条**已经存在但悬空**的实现接到地面，投入产出比最高，
   而且它产出的数据是 FB-3 右列的唯一来源；
2. **再 FB-2**，它是唯一能让「真实反馈进入系统」的入口，且与 FB-1 无耦合，可并行；
3. **然后 FB-3**，两列屏此时两边都有真数据，一次接线到位；
4. **FB-4 下一轮**。

⚠ 一条纪律写在前面：**这四条都不许在界面上留「点了没反应」的按钮**。
今天这块屏之所以看起来像做完了，正是因为每个按钮都在，只是点了什么都不会发生。
