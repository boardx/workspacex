/*
 * UC-17.8 B5.2 —— `design_project_chat_messages.source`：这条 AI 回复是模型说的还是退路。
 *
 * 契约：`packages/contracts/src/design-ai-collab.ts` 的 `AiReplySource`（`model` / `fallback`），
 * 投影到 `DesignProjectChatTurn.source`。草稿那边（B5.1）`chat` 是 jsonb 列、加键不需要迁移；
 * 这边对话是独立表，所以要一列。
 *
 * 可空：`user` 记录与 B5.2 之前写入的旧 AI 记录没有来源——「无」≠「模型说的」（该束
 * `domain.md` I-2），所以不给默认值、不回填。CHECK 与契约枚举同一个闭集。
 * 表是 append-only（B4.2 触发器），加列不动触发器。
 */
ALTER TABLE design_project_chat_messages
  ADD COLUMN IF NOT EXISTS source text NULL CHECK (source IN ('model', 'fallback'));
