-- F155（design delta `context-engine-l3-file-based`，人类 2026-08-14 签核）：
-- L3 上下文检索改走**文件式检索**——Postgres 原生全文索引，零新增外部依赖。
--
-- ## 这条迁移补的是 `GAP-CE-FTS-INDEX-MIGRATION`
--
-- delta §5 把「加 tsvector 生成列 + GIN 索引」列为签核后第一步。它覆盖 delta §1 的
-- 前两类「文件」：
--   1. 聊天附件 —— `chat_message_attachments.extracted_excerpt`（F153 抽取出的正文摘录）；
--   2. 落地的画布产物（含保存的 mermaid 图）—— `chat_artifact_landings` 新增
--      `content_excerpt`，由 `landAsArtifact` 落地时与 `content.md` **同一份 payload**
--      一起写入（字节本体仍在对象存储，这里只存有界摘录，索引不吃对象 I/O）。
-- 第 3 类「线程历史本身」由 L1/L2（#1111/#1123）已覆盖，本迁移不碰。
--
-- ## 为什么索引正文而不是只索引标题/文件名
-- verification.md V1/V2 的反证就是这一条：「把索引建在错误的列上（比如只索引文件名不索引
-- 正文），本断言当场红」。所以两个生成列都是 `标题/文件名 || 正文摘录` 的拼接——正文缺席
-- 时，按关键词问「我传的那份文件里写了什么」永远召不回来。
--
-- ## 为什么是 'simple' 而不是 'english'/'chinese'
-- `simple` 不做词干还原、不吃停用词表，对代号/标识符这类**精确关键词**（验收口径用的正是
-- 「独特代号」）召回稳定，且不依赖任何词典扩展的安装。⚠ 具名局限
-- `GAP-CE-FTS-CJK-SEGMENTATION`：Postgres 默认解析器不切分中文，整段中文会被切成很少的
-- 几个 token，纯中文长句的召回质量有限。这不是本迁移能就地解决的（要装 zhparser/pg_jieba
-- 一类扩展，属另一个数量级的部署决定），如实登记在这里，不在应用层假装它不存在。
--
-- ## 生成列的合法性
-- `to_tsvector(regconfig, text)`（**显式两参**）是 IMMUTABLE 的，可以用在
-- `GENERATED ALWAYS AS ... STORED` 里；单参 `to_tsvector(text)` 依赖
-- `default_text_search_config` 会话变量，是 STABLE，写进生成列会直接被拒——这里刻意写两参。
--
-- 可重放：全程 IF NOT EXISTS（migrate:check 会忽略版本表强制重放每个文件）。

/* ═══════════ 一、聊天附件（delta §1 第 1 类） ═══════════ */

ALTER TABLE chat_message_attachments
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(filename, '') || ' ' || coalesce(extracted_excerpt, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS chat_message_attachments_search_idx
  ON chat_message_attachments USING GIN (search_tsv);

/* ═══════════ 二、落地的画布产物（delta §1 第 2 类，含保存的 mermaid 图） ═══════════ */

-- 有界摘录，与附件侧 `extracted_excerpt` 同一种取舍（F153 迁移头注）：全文（`content.md`）
-- 仍在对象存储，这里只留供检索与召回展示的一段，上限由应用层
-- `LANDED_CONTENT_EXCERPT_MAX_CHARS` 单点决定，不在这里复述第二份数值。
ALTER TABLE chat_artifact_landings
  ADD COLUMN IF NOT EXISTS content_excerpt text;

ALTER TABLE chat_artifact_landings
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content_excerpt, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS chat_artifact_landings_search_idx
  ON chat_artifact_landings USING GIN (search_tsv);

/* ═══════════ 三、机械自检（列没建成就当场炸，不留「以为建好了」的绿） ═══════════ */

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'chat_message_attachments' AND column_name = 'search_tsv'
  ) THEN
    RAISE EXCEPTION 'chat_message_attachments.search_tsv did not get added';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'chat_artifact_landings' AND column_name = 'content_excerpt'
  ) THEN
    RAISE EXCEPTION 'chat_artifact_landings.content_excerpt did not get added';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'chat_artifact_landings' AND column_name = 'search_tsv'
  ) THEN
    RAISE EXCEPTION 'chat_artifact_landings.search_tsv did not get added';
  END IF;
END
$$;

-- 本迁移没有新增表，只加列与索引：RLS 策略与 app_rw 授权沿用两张表既有的（生成列随表
-- 授权，不需要单独 GRANT），因此**不**重复调用 `kernel_apply_org_freeze_policies()`——
-- 那个调用是「新增租户表」时才必须的（见 F153/F154 迁移尾注）。
