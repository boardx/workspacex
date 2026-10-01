# PROP-PROJECT-HUB-001 — 项目中枢：项目作为 chat / 权限 / 项目大脑的共享容器（十轮 ad-hoc 迭代收口）

状态：已落地（十轮 PR 全部开出；合入状态以 GitHub 为准，本文不复述）
提出：2026-09-27（用户直接交办，ad-hoc 流程，无 `design-signoff.md`——如实记录，见 `ad-hoc-fix-pr-sop.md`）
相关：ADR-101（provenance 事件枚举追加）、phase-18 组织大脑（`kg_*` 迁移、`knowledgeGraph` 契约）、F15 邀请链接、F125 项目成员

## 1. 一句话

用户的验收口径原话：「十轮之后必须要可以使用，用户可以在项目里面创建 chat，chat 可以在用户之间分享，
项目是必须要邀请才可以进来的，需要有邀请的过程，项目也是一个权限管理的容器，同时也可以用在项目大脑上来做推理。」
十轮各自一个 issue、一个 PR（`Refs #N`），分支 `claude/admiring-gauss-adgfja-rN` 逐轮叠放。

## 2. 十轮做了什么

| 轮 | issue / PR | 交付 | 单一事实源 |
|---|---|---|---|
| R0 | #4357 / #4358 | 删光 `lib/mock/project.ts`，项目工作台各 tab 改为诚实空态 | `apps/web/lib/project-workbench.ts` |
| R1 | #4370 / #4371 | 非项目成员打开项目 ⇒ 服务端 `NO_PROJECT_ROLE` ⇒ 界面 `project-access-denied`（项目是受邀才能进的容器） | `project-workbench.tsx` `accessDenied` |
| R2 | #4374 / #4376 | 契约 `acceptProjectInvite`；`project-invite.controller.ts`（issue / revoke / accept）；设置 tab「邀请成员」面板；`/projects/join?t=` 落地页 | `application/project/accept-project-invite.ts` |
| R3 | #4377 / #4380 | 设置 tab 真实成员名单 + 指派 / 改角色 / 移出（项目是权限容器） | `components/project/project-members-panel.tsx` |
| R4 | #4379 / #4381 | 研究洞察 › 对话：真实线程列表 + 「在本项目中新建对话」 | `components/project/project-conversations.tsx` |
| R5 | #4384 / #4388 | 契约 `mutateThread.op = setVisibility`（member-private / group-shared / plenary）；每条对话可改可见范围（chat 在成员间分享）；provenance `thread-visibility-changed` + 迁移 `20260927130000` | `application/chat/mutate-thread.ts` |
| R6 | #4387 / #4389 | `tests/project/project-permission-chain.test.ts`：HTTP + PG 全链路权限反证 | 同左 |
| R7 | #4394 / #4395 | 组织大脑放开 `project` 作用域（L2）：`kg_promote_claim_to_project`、`promoteToProject`、召回并入项目记忆、知识面板「记到项目大脑」 | 迁移 `20260927120000_kg_r7_project_scope.sql` |
| R8 | #4397 / #4398 | 契约 `getProjectKnowledge`；研究洞察「项目大脑」面板（按类型分组、三态、证据数；成员门） | `application/knowledge-graph/read-project-knowledge.ts` |
| R9 | #4399 / #4402 | 推理：「假设与矛盾」一节（矛盾单列、猜测按净证据升序）；项目结论的来源回链（`getClaimSources` 项目分支） | `read-thread-knowledge.ts` `projectClaimSources` |
| R10 | #4403 | 北极星真栈 e2e `core-journey-06-project-invite-chat-share.spec.ts` + 本文 | 同左 |

## 3. 权限模型（一处说清）

- **进项目**：`project_memberships` 是唯一凭据。进来的路径只有两条：引导师 / lead 直接指派（F125），或持邀请链接
  `acceptProjectInvite`（R2；先判组织成员资格，跨组织的 token 与不存在同一出口）。
- **看 chat**：`resolveVisibility`（既有）。项目里新建的对话默认 `group-shared`；分享 = 改 `visibilityScope`，
  只有创建者或本项目引导师能改，只能在 member-private / group-shared / plenary 三档之间（R5）。
- **看项目大脑**：项目成员（含观察者）才能读 `getProjectKnowledge` / 项目结论的来源；非成员 403 `KG_NOT_VISIBLE`
  或与不存在同一出口（R8 / R9）。**只靠 `authorize(read.published)` 不够**——对没有 ACL 绑定的项目对象它在组织层就放行，
  所以两处都显式先查成员资格（单测反证抓出来的）。
- **写项目大脑**：线程创建者或本项目引导师才能「记到项目大脑」（R7，SQL 函数内判）。

## 4. 已知缺口（如实，不假装做完）

- 录音 / 深度研究 / 用户研究 / survey **还没有**挂进项目容器：研究洞察的「来源」「待验证」两个子页仍是诚实空态。
  每一项都要各自的契约（`projectId` 外键 + 列表接口）与成员门，不在这十轮范围。
- 项目大脑的推理只到「按类型分组 / 假设按证据排序 / 矛盾单列 / 来源回链」；跨对话的自动矛盾检测（F16 的 conflict prompt）
  仍只在会话作用域触发，项目作用域没有接。
- 邀请链接的「邀请码」通道（`inviteCode`）沿用 F15 既有实现，本轮没有为它做独立 e2e。
- 叠放的 PR 在前序合入前 `verify-affected` 会因取不到 stacked base 而红（CI 脚本只 fetch main），需逐个改基到 main。

## 5. 否决时的回退

每轮一个 PR，可逐轮 revert；R5 / R7 各带一条迁移（`20260927130000` / `20260927120000`），回退顺序与合入相反。
