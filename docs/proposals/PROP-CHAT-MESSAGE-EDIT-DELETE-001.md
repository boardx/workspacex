# PROP-CHAT-MESSAGE-EDIT-DELETE-001 — 消息级编辑/删除策略

> 状态：**两条核心口径已由人类裁决（2026-08-22），细节形状待走 ADR-023 契约签核后实现**。
> 发起：人类直接提出"chat 需要编辑和删除的策略"——核实为**全新能力**，消息级编辑/删除
> 在本仓一次都不存在（`grep` 全仓零命中任何组件/用例/设计文档）。**线程级**重命名/删除
> 已经有（`mutate-thread.ts`），不在本提案范围内。

## 一、已裁决的两条口径

| # | 问题 | 裁决 |
|---|---|---|
| D-1 | 编辑一条已有后续 AI 回复的消息，下游怎么办？ | **分支**（ChatGPT/Claude 同款）：旧版本保留，新建分支重新跑 AI，界面用"1/2"切换 |
| D-2 | 删除一条已被引用的消息（已落地为产物/已被 citation 引用），怎么办？ | **软删除 + 墓碑占位**：`deleted_at` 标记、行保留，界面显示"这条消息已删除"；不用 F46 那套 artifact 级 trash queue/legal hold（对聊天消息过重） |

## 二、现状核实（决定"策略"必须长什么样的约束，不是可选项）

- `chat_messages`（`0021-f108-chat-visibility.sql:83`）**没有** `updated_at`/`deleted_at`/
  版本号列——本仓聊天消息目前是纯 append-only 表，这不是巧合，是本仓反复出现的"不硬删除、
  只软删除留痕"纪律（`legal_holds`/`deletion_tasks`/`artifacts.deleted_at` 都是这个形状）。
- **五张表通过 `message_id` 外键指向 `chat_messages.id`**（均 `ON DELETE CASCADE`，
  但本仓从未真正对 `chat_messages` 发过硬 DELETE，这个 CASCADE 目前只在"整条线程被级联删除"
  时才会触发）：
  - `chat_citations`（F111，`20260731170746_f111_chat_citations.sql:23`）—— 引用溯源
  - `chat_message_attachments`（F153/#946，`20260811060000_i946_chat_message_attachments.sql:15`）
  - `chat_message_ratings`（F176，`20260814120000_f176_message_ratings.sql:54`）
  - `agent_runs.input_message_id`（wave2，`20260804060000_wave2_chat_message_acceptance.sql:27`，
    **`UNIQUE (org_id, input_message_id)`**——一条消息至多触发一次 run）
  - `chat_artifact_landings.message_id`（F114，`20260801190000_f114_chat_artifact_landings.sql:29`，
    I-33 出处回链，**不带外键约束**，靠应用层保证）
- `agent_runs.input_message_id` 的 **UNIQUE 约束是关键结构性事实**：这意味着"编辑一条消息后
  原地重新触发一次 run"在当前 schema 下**做不到**——同一个 `input_message_id` 不能对应第二个
  run。这从数据库层面就排除了"简单地改文字、复用同一条消息触发新 run"这条路径，**印证了
  D-1 裁决的"分支＝新建消息行"是唯一在当前 schema 上走得通的形状**，不是纯粹的产品偏好。
- `chat_messages` 已有 `reply_to_message_id` 列（wave2 acceptance），但那是"这条 agent 回复
  在回应哪条人类消息"的**纵向**链接，与本提案需要的"这条消息取代了哪条消息"的**横向**
  supersession 链接是两件不同的事，不能复用同一列。

## 三、Schema 形状（提案，未签核，未实现）

```sql
-- chat_messages 新增两列
ALTER TABLE chat_messages ADD COLUMN deleted_at timestamptz;
ALTER TABLE chat_messages ADD COLUMN superseded_by_message_id text
  REFERENCES chat_messages (id);
-- 新建一条"编辑版"消息时：
--   1. 插入新行 M'（body=编辑后的文字，author 与原消息相同）
--   2. UPDATE 原消息 M SET superseded_by_message_id = M'.id
--   3. 从 M' 触发一次新 run（走既有 sendMessage 代码路径，不是新造一套）
-- M 之后（原分支）的消息不删除、不改动——它们仍然存在，只是默认视图不再显示，
-- 界面用"1/2"切换回去时按原样读出。
```

- **默认渲染**：从线程头部走到尾部时，遇到 `superseded_by_message_id IS NOT NULL` 的消息，
  跳到它指向的那条继续渲染（即渲染"当前活跃分支"），不渲染被取代的旧消息本体（但界面上
  露出"1/2"切换入口）。
- **删除**：`DELETE` 操作只是 `UPDATE chat_messages SET deleted_at = now()`。渲染时把
  `deleted_at IS NOT NULL` 的消息换成墓碑占位（"这条消息已删除"），不显示正文。已经依赖
  这条消息的 citation/attachment/artifact-landing **不因软删除而断链**——它们的
  `message_id` 外键依然解得到这一行（只是正文被界面隐藏），出处回链（I-33）不受影响。
- **谁能编辑/删除**：编辑仅限**消息作者本人**（编辑 AI 的话等于伪造 AI 输出，不允许）；
  删除对齐现有写权模型——线程写角色（同 `createMessage`/`land-as-artifact` 判定路径）
  可删除线程内任意消息（含他人的，同"版主可删帖"），不新造一套权限判据。

## 四、不在本提案范围内（明确排除，避免范围蔓延）

- 线程级重命名/删除（已存在，`mutate-thread.ts`）。
- 编辑/删除 agent 自己生成的消息正文（AI 消息只能删，不能改文字）。
- 消息树的多分支并行展示（原型/主流产品也只做"当前分支 + 历史分支切换"，不做多分支并排）。
- 删除后的硬清除/彻底擦除（如需合规硬删除，走 F46 那套 artifact 级机制，不在本提案内建）。

## 五、下一步

这是一次**结构性契约变更**（新增列、新增两个操作 `editMessage`/`deleteMessage`、
渲染逻辑改分支感知），按 AGENTS.md 的契约先行流程，需要：
1. 补 `packages/contracts/src/chat.ts` 的 `editMessage`/`deleteMessage` 操作形状。
2. 走 ADR-023 契约束设计签核（UI + 用例 + API 契约三件），不是直接开工。
3. 建 issue、由实现者按签核后的契约开工。

本文档只交付"策略是什么"，不代表任何代码已经开始改动。

---
*本文档由 Claude Code 于 2026-08-22 整理，两条核心口径已经人类当场裁决，
schema 形状是核实过真实约束（`agent_runs.input_message_id` 的 UNIQUE 约束）后的提案，
供下一步契约签核使用。*
