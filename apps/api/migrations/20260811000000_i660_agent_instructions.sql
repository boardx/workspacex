-- #660 —— `agents.instructions`：用户自建 agent 的**可执行定义**。
--
-- 出处：`phases/phase-01-run-a-project/design-deltas/agent-instructions/design-signoff.md`
-- 的裁决点 ③，人类 2026-08-11 选定**候选 A**（「给 `updateAgentDefinition.patch` 加
-- `instructions`，`agents` 加列」）。
--
-- ## 它补的是什么
--
-- `agent_versions.instructions` 是 NOT NULL，而在这一列之前，**用户在浏览器里建出来的
-- agent 没有任何字段能承载「这个 agent 到底执行什么」**（`agents` 无该列、契约 grep 零命中）。
-- 于是即使发布门全过，也拼不出一条可执行的 `agent_versions` 行 —— #856 接通发布状态机
-- 之后 422 依旧，根因就是这一条。
--
-- ## ⚠ 为什么可空，而不是 NOT NULL DEFAULT ''
--
-- 「还没写指令」与「指令是空字符串」必须可分辨：前者是**尚未配置**（发布时明确拒绝，
-- `AGENT_NO_EXECUTABLE_DEFINITION`），后者会让一个没有任何行为约束的 agent 被发布出去。
-- 一个 `DEFAULT ''` 会把全部存量行悄悄变成"已配置且为空"，正是那种发布后才发现的漂移。
-- ⇒ 存量行保持 NULL，语义是「没配过」，与新建行一致。
--
-- ⚠ 本列**不**回填任何由 `name` / `role` 拼出来的内容。delta 文件逐字禁止过这条捷径
-- （`role` 是「角色标签」不是「系统提示词」，运行时会真的按它执行）。存量自建 agent
-- 因此仍然发不出去，直到它的作者自己写一段指令 —— 这是诚实的结果，不是遗漏。
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS instructions text;

COMMENT ON COLUMN agents.instructions IS
  '用户自建 agent 的可执行定义（系统提示词）。NULL = 尚未配置，发布时被拒；'
  '非空才能铸出 agent_versions 行。出处：design-deltas/agent-instructions 候选 A（#660）。';

-- 长度上限：delta ③ 候选 A 的「代价」一栏点名要考虑它。取 8000 字符 —— 与
-- `agent_versions.instructions` 实际承载的系统提示词同量级，且远低于任何模型的上下文
-- 上限，超出的是"把整份文档粘进来"这种误用，不是正常配置。
-- ⚠ 空白串按"未配置"处理不在这里判（那是 domain 的事），这里只拦长度。
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_instructions_length;
ALTER TABLE agents
  ADD CONSTRAINT agents_instructions_length
    CHECK (instructions IS NULL OR length(instructions) <= 8000);
