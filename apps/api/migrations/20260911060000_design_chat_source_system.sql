/*
 * 2026-09-10 线上实测 —— 导入 session 报 HTTP 500 的根因。
 *
 * 迭代 13 的「导入线程作为背景」在确认阶段往 `chat` 追加一条留痕，`source: "system"`
 * （`import-thread.ts`；契约 `AiReplySource` 那时就加上了 `system`）。但这一列的 CHECK
 * 还停在 B5.2 的两值闭集 —— INSERT 直接被约束打回，异常从 `mapProjectError` 漏出去，
 * 用户屏上只剩一个 `http_500`。预览阶段不写库，所以「摘要看得见、一确认就炸」。
 *
 * ⚠ 这是「同一事实声明在两处」的又一次：闭集在契约里、也在这条 CHECK 里，加值时只改了
 *   一处。`tests/design-workbench/chat-source-enum.test.ts` 现在机械核对两者，再漂就红。
 *
 * 幂等：先删旧约束再按当前闭集重建（`ADD COLUMN IF NOT EXISTS` 那次建的匿名约束由
 * pg 命名为 `design_project_chat_messages_source_check`）。表 append-only，不动触发器。
 */
ALTER TABLE design_project_chat_messages
  DROP CONSTRAINT IF EXISTS design_project_chat_messages_source_check;
ALTER TABLE design_project_chat_messages
  ADD CONSTRAINT design_project_chat_messages_source_check
  CHECK (source IN ('model', 'fallback', 'system'));
