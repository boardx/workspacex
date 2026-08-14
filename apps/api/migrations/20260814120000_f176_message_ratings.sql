/*
 * F176 —— 消息级评价的落库面 `message_ratings` + 数据质量报表 `rating_data_quality_entries`。
 *
 * ## 为什么现在才有这张表
 *
 * F68（消息级评价采集与归因）标着 passing，但它做到 application 层就停了：
 * `domain/skill/rating-attribution.ts`（纯函数）与 `application/skill/rate-message.ts`
 * （用例）都完整且被测过，而 `RatingRepositoryPort` / `DataQualityReportPort`
 * **全仓没有任何实现**，migrations 里 grep `message_rating` 零命中，
 * `skill.controller.ts` 自己写着「rateMessage 不在 #459 范围内」。
 * ⚠ 这不是假 passing——F68 验的那层真的成立，只是那层之下是空的。本迁移是地基。
 *
 * ## 幂等键是数据库约束，不只是用例里的一次查询（V13）
 *
 * `rate-message.ts` 先 `findByIdempotencyKey` 再 `save`——两次往返之间有窗口，
 * 两个并发请求会双双查到 null 然后都写进去。**「同一人对同一条消息只算一次」这句话
 * 因此不能只由用例担保**，`UNIQUE (org_id, message_id, rater_id)` 才是它的落点。
 * 用例层那次查询保留：它负责返回**已存在的那条**（幂等重放要回同一个 ratingId），
 * 唯一约束负责保证并发下也只有一行。两者不重复，是同一条规则的两半。
 *
 * ## 归因三列可空，且 `skill_id` / `skill_version_id` 必须同生同死
 *
 * I-20：两者同时非空才计入 skill 满意度，缺任一项降级为「只计 agent 级」。
 * 所以 CHECK 写成「要么都为 NULL，要么都非 NULL」——一条只有 skill_id 的记录在
 * `classifyAttribution` 眼里等价于全空，让它能存进来只会制造一种没人读的状态。
 *
 * ⚠ 归因三列**不加 FK**。skill 版本可以被归档、agent 可以被停用，而评价是历史事实：
 * 「这条评价当时归给了哪个版本」不该因为那个版本后来被清理而变成 NULL 或写不进来。
 * 同 `token_usage_events.user_id` 不加 FK 的理由。
 *
 * ## Append-only（与 `token_usage_events` / `agent_run_steps` 同一条纪律）
 *
 * `RatingRepositoryPort` 结构上就没有 `update`——文件头逐字：「一条评价一旦落库不可再改，
 * 撤销/改评价（R10『待确认』）留给未来另起一个方法，不在这里悄悄允许」。
 * 数据库这一半把「悄悄允许」这件事也堵死：GRANT 只给 SELECT/INSERT，
 * 外加 BEFORE UPDATE OR DELETE 触发器。组织删除时的级联是生命周期清理不是调用方改写，
 * 沿用 F159 同一个豁口写法。
 *
 * ## 为什么数据质量报表是**另一张表**而不是 message_ratings 上的一个布尔列
 *
 * E1 要求的是「缺归因的评价必须**可被列出**」。做成布尔列时，那句话的实现是一次
 * `WHERE skill_version_id IS NULL` 的查询——它会随查询写法漂移，且没有地方记
 * 「为什么缺」。单独一张表让 `DataQualityReportPort.record` 有个真实落点，
 * 也让「报表里有几条」成为可以直接数的事实。
 *
 * Replayable：全部 IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS，重放安全。
 */

CREATE TABLE IF NOT EXISTS message_ratings (
  id              text PRIMARY KEY,
  org_id          text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 评价的对象是一条 AI 消息。加 FK：消息没了这条评价就没有意义，
  -- 与归因三列（历史事实）不同。
  message_id      text NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  -- ⚠ 只用于幂等去重与人群计数。D-40：评价不公开署名，投影时不得原样透出
  -- （`RatingRecord` 的头注逐字）。不加 FK 到 credentials，同 token_usage_events.user_id。
  rater_id        text NOT NULL,
  verdict         text NOT NULL CHECK (verdict IN ('up', 'down')),
  reason          text NULL,
  -- 归因三列：服务端从 agent_runs 查出来的，**不接受请求体传入**。
  agent_id           text NOT NULL,
  skill_id           text NULL,
  skill_version_id   text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- V13 的落点。见文件头。
  CONSTRAINT message_ratings_idempotent UNIQUE (org_id, message_id, rater_id),
  -- I-20：同生同死。
  CONSTRAINT message_ratings_attribution_pairing CHECK (
    (skill_id IS NULL) = (skill_version_id IS NULL)
  )
);

/* 满意度按 skill 版本聚合（O-37），所以索引到版本这一级；
   `WHERE skill_version_id IS NOT NULL` 让它只覆盖真正会被聚合的那些行。 */
CREATE INDEX IF NOT EXISTS message_ratings_skill_version_idx
  ON message_ratings (org_id, skill_id, skill_version_id)
  WHERE skill_version_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rating_data_quality_entries (
  rating_id  text PRIMARY KEY REFERENCES message_ratings (id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agent_id   text NOT NULL,
  -- 闭集。`DataQualityEntry.reason` 今天只有一个值；写成闭集是为了下一个值必须
  -- 显式加进来，而不是让某处新写的字符串静默成为一种新原因。
  reason     text NOT NULL CHECK (reason IN ('missing-skill-version')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rating_data_quality_entries_org_idx
  ON rating_data_quality_entries (org_id, created_at DESC);

CREATE OR REPLACE FUNCTION f176_message_ratings_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'message ratings are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS message_ratings_append_only_trg ON message_ratings;
CREATE TRIGGER message_ratings_append_only_trg
  BEFORE UPDATE OR DELETE ON message_ratings
  FOR EACH ROW EXECUTE FUNCTION f176_message_ratings_append_only();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['message_ratings', 'rating_data_quality_entries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
    EXECUTE format('REVOKE ALL ON %I FROM app_rw', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO app_rw', t);
  END LOOP;
END
$$;

SELECT kernel_apply_org_freeze_policies();
