-- 0029 F109: 线程列表 —— 待复核标记 / 转录会话真实状态 / 线程的 messages.jsonl 指针
-- (phase-01 contracts/chat/domain.md B 组 I-13 / I-14 / I-15 / I-16，uc-8-1 R7)
--
-- ## 这个文件在防什么
--
--   · I-13「两处数值恒相等」—— 数值只有一个来源才谈得上相等。所以「待复核」是
--     **消息上的一列**（`chat_messages.review_pending`），列表的 N 是它的 COUNT，
--     消息头的 N 是同一列的投影。做成「线程上的一个计数列」就立刻有了第二份真相：
--     计数列与消息实际状态会在第一次并发写之后分家，而分家之后两处仍然各自「自洽」。
--
--   · I-14「`● 转录中` 不得由最后消息时间推断」—— 推断需要一个可推断的东西，
--     所以这里给的是**不可推断的东西**：一张会话表，`stopped_at IS NULL` 即在录。
--     「最后消息很新但转录已停」这个用例只有在状态与消息时间是两列时才构造得出来。
--
--   · I-16「每个线程恰好一个 `messages.jsonl`」—— 指针表 `chat_thread_files` 的主键是
--     `thread_id`。「一个」这件事因此是**主键**，不是一条约定：想给同一线程再登记
--     第二个文件，INSERT 直接失败。
--
-- ## 这个文件刻意**没有**做的事
--
--   · 没有为 `messages.jsonl` 新建任何「文件表」。它就是 phase-00 F04 的
--     `artifacts` + `artifact_versions`（`source='conversation'` 的物化计划里逐字写着
--     `messages.jsonl`）。另建一张，22-files 就会有两个证据平面——
--     `contracts/chat/coverage.md` 缺口 10 与 `design-signoff.md` X-5 讲的正是这条。
--     本表只存**指针**：线程 → 已物化的那个 artifact 版本。
--
--   · 没有给 `chat_threads` 加任何可见性 RLS 策略，理由同 0021 头部：
--     RLS 认得租户，认不得「本组组长」。租户由 RLS 兜，可见性由 domain 兜。
--
-- 可重放：全部 IF NOT EXISTS / DROP-then-ADD，`migrate:check` 会强制重放每个文件。

/* ═══════════════ 〇、线程标题 ═══════════════ */

-- 0021 建 `chat_threads` 时没有标题列：F108 只判权，判定不需要标题（那份 `ThreadFacts`
-- 刻意不含 title，见 thread-visibility.ts）。列表要显示它，所以在这里补。
--
-- DEFAULT '' 而不是 NOT NULL 无默认：已有行（F108 的测试夹具）没有标题可填，
-- 而一次会失败的迁移与一次没跑的迁移在部署里长得一样。
-- CHECK 留给应用层的 `TITLE_INVALID`——「什么是合法标题」是产品规则，不是数据完整性，
-- 写进 CHECK 就等于把它声明在了第二处（契约的 `TITLE_INVALID` 是第一处）。
ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';

/* ═══════════════ 一、待复核（I-13 的单一事实源）═══════════════ */

-- ADD COLUMN IF NOT EXISTS 而不是回去改 0021 的 CREATE TABLE：0021 是
-- `CREATE TABLE IF NOT EXISTS`，在已有库上是**静默空操作**，于是「加了列」与「没加成」
-- 长得一模一样（0023 头部踩过同一个坑）。
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS review_pending boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN chat_messages.review_pending IS
  'I-13: 「待复核」的唯一事实源。线程卡的「N 条待复核」与消息头的「待复核 N」都是这一列的投影；'
  '任何在别处求和的写法都是第二份真相。由 tests/chat/thread-badge-single-source.test.ts 门控。';

-- 列表的 N 是这张索引上的一次 COUNT，不是一列缓存。
CREATE INDEX IF NOT EXISTS chat_messages_review_pending_idx
  ON chat_messages (org_id, thread_id) WHERE review_pending;

/* ═══════════════ 二、转录会话（I-14：状态是状态，不是时间戳的函数）═══════════════ */

CREATE TABLE IF NOT EXISTS chat_transcript_sessions (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id  text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  -- NULL = 仍在录。`● 转录中` 恒等于「存在一行 stopped_at IS NULL」。
  stopped_at timestamptz
);

-- 一个线程同一时刻最多一个在录会话。少了它，「停止录音」要停哪一个没有答案，
-- 而没有答案的地方下一个实现者会解成「停最新那个」，于是另一个永远停不掉。
CREATE UNIQUE INDEX IF NOT EXISTS chat_transcript_sessions_one_live
  ON chat_transcript_sessions (org_id, thread_id) WHERE stopped_at IS NULL;

COMMENT ON TABLE chat_transcript_sessions IS
  'I-14: 转录徽标绑定的真实运行态。存在的理由就是让「最后消息很新但转录已停」可被构造——'
  '按最后消息时间推断的实现在这张表面前会当场变红。';

/* ═══════════════ 三、线程 → messages.jsonl 的指针（I-16）═══════════════ */

CREATE TABLE IF NOT EXISTS chat_thread_files (
  -- 主键就是「恰好一个」。见文件头。
  thread_id      text PRIMARY KEY REFERENCES chat_threads (id) ON DELETE CASCADE,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 指向 phase-00 F04 的六表模型。**不复制**它的任何字段（大小/哈希除外，见下）。
  artifact_id    text NOT NULL REFERENCES artifacts (id) ON DELETE CASCADE,
  --
  -- ⚠ **这里刻意没有 `version_id REFERENCES artifact_versions`**，而第一版有。
  --
  -- 加上它之后，phase-00 的 `reference-eligibility-gate.test.ts` 当场变红：
  -- I-14「the door is the only door」把「schema 里哪些表可以直接指向一个 artifact 版本」
  -- 写成了一条**枚举断言**，因为一张带 `artifact_version_id` 列的新表能满足引用资格门的
  -- 每一条断言并绕过全部——那正是 coverage 缺口③说的「各自判各自的」。
  --
  -- 有两条路：把 `chat_thread_files` 加进那张名单（F13 的 `context_packs` 就是这么做的，
  -- 并附了理由与结构断言），或者**本束不持有版本指针**。选后者：
  --   · 契约的 `getThreadMessagesFile.out` 只要 `objectKey / sha256 / sizeBytes / downloadUrl`，
  --     版本号本来就编码在 objectKey 的 `/v<n>/` 里，指针不是必需的；
  --   · X-5 逐字说对话侧不得另建证据平面，而一个指向版本的外键就是那个平面的第一根柱子；
  --   · 改另一个**已签核束**的门控名单不是本 feature 该做的决定。
  -- ⇒ 记在这里，是因为「为什么没有 version_id」比「有 version_id」更需要解释。
  object_key     text NOT NULL,
  -- ⚠ sha256 / size 是**投影**，不是第二份真相：契约 `getThreadMessagesFile.out` 逐字要
  --   这两个字段，而它们在 `artifact_versions` 里已有。这里存的是那一行的副本，
  --   由 `materializeArtifact` 一次写入、此后不改（版本不可变，I-2/I-3 已在 phase-00 门控）。
  --   之所以不 JOIN 出来：JOIN 需要读 artifact_versions，而那张表的读路径属 artifact 束；
  --   对话侧多开一条读路径，就多了一处要跟着可见性走的地方。
  sha256         text NOT NULL,
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0),
  materialized_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_thread_files_org_idx
  ON chat_thread_files (org_id, thread_id);

COMMENT ON TABLE chat_thread_files IS
  'I-16: 线程 → 已物化 messages.jsonl 的指针。主键为 thread_id ⇒「每线程恰好一个」是主键而非约定。'
  '本表不是第二个文件表：字节与版本在 phase-00 的 artifacts/artifact_versions 里（缺口 10 / X-5）。';

/* ═══════════════ 四、RLS：与其余租户表同一条规则 ═══════════════ */

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_transcript_sessions', 'chat_thread_files']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE：表属主也受策略约束。少了它，以属主身份跑的任何路径都是一条无声的旁路。
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    -- current_setting(..., true) 未设置时为 NULL ⇒ 无租户上下文的查询看到零行（fail-closed）。
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_transcript_sessions TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_thread_files TO app_rw;

-- 组织停用后只读降级（F22 / 迁移 0014）：**新建的租户表必须自己补这一次调用**，
-- 否则这两张表拿不到三条 AS RESTRICTIVE 冻结策略，而 F22 的断言依旧全绿
-- （它们测的是当时已存在的那些表）。0021 头部把这个坑写过一遍，这里只是照做。
SELECT kernel_apply_org_freeze_policies();
