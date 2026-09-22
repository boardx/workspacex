/*
 * 2026-09-16 人类实测 —— 侧栏对话列表仍然不可辨认。
 *
 * #2094 的自动命名只看**首条**用户消息（`domain/chat/thread-title.ts`），而实测截图里
 * 首条消息大量是「你好」「你可以做什么?」「请检查」——照它起出来的名字逐字就是这些，
 * 与「新对话」一样找不回历史任务。真正能概括一次会话的信息在**后面**才出现。
 *
 * 本迁移给「会话级标题」这条算法补两列状态。两列都是**判定要用的事实**，必须在库里，
 * 不能靠调用方约定：
 *
 *   · `title_source`：标题现在归谁。`user`（手动改过）**永不**被自动命名覆盖——此前
 *     这条由 `WHERE title = '新对话'` 兜着，但一旦允许自动命名改写「自动起过的名字」，
 *     那个条件就不再能区分「自动名」和「用户名」，必须显式记下来。
 *   · `auto_title_stage`：自动命名走到了阶梯的第几档（`thread-title-algorithm.ts` 的
 *     `TITLE_REFRESH_LADDER`）。UPDATE 带 `auto_title_stage < $stage` 就是单调推进的
 *     保证——并发的两次重命名里低档那次命中 0 行，不会把高档结果盖回去。
 *
 * 回填口径（**保守**，故意不聪明）：现有标题只要不是默认名，一律记为 `user`。库里没有
 * 任何痕迹能区分「用户改的」和「#2094 自动起的」，而猜错的两个方向代价不对称——把用户
 * 亲手起的名字改掉是数据损失，把一个旧的烂自动名留着只是维持现状。存量线程因此不会被
 * 本算法改名；新会话从第一条消息起走新算法。
 */
ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS title_source text NOT NULL DEFAULT 'default';
ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS auto_title_stage smallint NOT NULL DEFAULT 0;

ALTER TABLE chat_threads
  DROP CONSTRAINT IF EXISTS chat_threads_title_source_check;
ALTER TABLE chat_threads
  ADD CONSTRAINT chat_threads_title_source_check
  CHECK (title_source IN ('default', 'auto', 'user'));

-- 回填：见头注「回填口径」。幂等——只动仍停在建表默认值 'default' 的行。
UPDATE chat_threads
   SET title_source = 'user'
 WHERE title_source = 'default' AND title <> '新对话';
