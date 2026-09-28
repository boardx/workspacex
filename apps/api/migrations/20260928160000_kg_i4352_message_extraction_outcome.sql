/*
 * Issue #4352 —— 每条消息的抽取结果 + 「整理本会话」（UC-KG-4 requestReindex）的重新排队。
 *
 * ## 1. 每条消息的抽取结果（`kg_message_extraction_outcomes`）
 *
 * 队列行在任务完成时被删掉（`kg_extraction_queue` 只装「还没做完的」），于是「这条消息抽过了、但没有可记的」
 * 在库里不留任何痕迹——发送下方那一行「这句没有需要记的 · 记一条」没有信号源。这张表记每条消息**最近一次**
 * 抽取的结论：
 *   - written  抽出了东西，交给了执行器；
 *   - empty    模型合法地回了「没有可记的」（或抽出的东西全被过滤 / 被执行器拒绝）；
 *   - skipped  有意不抽（项目会话里用过个人记忆的那一轮 agent 回答，#4284）；
 *   - failed   重试次数用完。
 * 写入只在 worker 的 complete / fail 里（与删队列行 / 记失败同一条语句，围栏令牌对不上就一起不写）。
 * 「还在队列里」由队列本身回答，不在这里重复记（同一事实不写两处）。
 *
 * ⚠ 契约字段 `KgMessageExtraction.status`（#4352 contract field: per-message extraction status）按人类
 *   2026-09-27 的决定先行实现、**签核后补**——见 evidence/phase-18/r10/README.md §3.2。
 *
 * ## 2. 「整理本会话」重新排队（`kg_extraction_requeue_thread`）
 *
 * 队列只经触发器写入（app_rw 没有 INSERT 权限），重新排队同样只经一个 SECURITY DEFINER 函数：
 *   - 租户取 `app.current_org`（调用方在 withTenant 里），不接受参数传入的 org；
 *   - 与触发器同一套「这条消息能不能抽」的条件：非原始转录、非空白、没有比会话更窄的可见范围；
 *   - 与触发器同两道开关：部署开关、组织开关任一关着 ⇒ 什么都不排，返回 0（「关闭期间的消息不会整理」，
 *     开关打开之后再点「整理本会话」补）；
 *   - 本会话还有在整理中的行（次数没用完——上限由调用方传 KG_EXTRACTION_MAX_ATTEMPTS，SQL 不另写一份；或租约还活着）⇒ 返回 -1（KG_REINDEX_ALREADY_RUNNING），不叠加；
 *   - 已经用完次数的失败行重置为新任务（「失败 · 重试」走同一条路）；已完成的消息重新排进来重抽——执行器按
 *     `sourceRef + pipeline 版本` 幂等（I-7），不会产生重复行。
 */

CREATE TABLE IF NOT EXISTS kg_message_extraction_outcomes (
  message_id  text PRIMARY KEY REFERENCES chat_messages (id) ON DELETE CASCADE,
  org_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id   text NOT NULL,
  outcome     text NOT NULL CHECK (outcome IN ('written', 'empty', 'skipped', 'failed')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kg_message_extraction_outcomes_thread_idx ON kg_message_extraction_outcomes (org_id, thread_id);

ALTER TABLE kg_message_extraction_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_message_extraction_outcomes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_message_extraction_outcomes_tenant ON kg_message_extraction_outcomes;
CREATE POLICY kg_message_extraction_outcomes_tenant ON kg_message_extraction_outcomes
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON kg_message_extraction_outcomes FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON kg_message_extraction_outcomes TO app_rw;

CREATE OR REPLACE FUNCTION kg_extraction_requeue_thread(p_thread text, p_source_refs text[], p_lease_seconds integer, p_max_attempts integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org text := nullif(current_setting('app.current_org', true), '');
  v_n integer;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'kg_extraction_requeue_thread: no tenant' USING ERRCODE = '42501'; END IF;
  IF p_max_attempts IS NULL OR p_max_attempts < 1 THEN
    RAISE EXCEPTION 'kg_extraction_requeue_thread: max attempts %', p_max_attempts USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kg_extraction_state WHERE enabled) THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.kg_org_extraction_settings WHERE org_id = v_org AND NOT enabled) THEN RETURN 0; END IF;
  -- 同一会话并发两次「整理」：锁住这一会话的队列行再判，免得两次都看到「没在整理」。
  PERFORM pg_advisory_xact_lock(hashtext('kg_requeue:' || v_org || ':' || p_thread));
  IF EXISTS (
    SELECT 1 FROM public.kg_extraction_queue q
     WHERE q.org_id = v_org AND q.thread_id = p_thread
       AND (q.attempts < p_max_attempts OR (q.locked_at IS NOT NULL AND q.locked_at >= now() - make_interval(secs => p_lease_seconds)))
  ) THEN
    RETURN -1;
  END IF;
  INSERT INTO public.kg_extraction_queue (message_id, org_id, thread_id)
  SELECT m.id, m.org_id, m.thread_id FROM public.chat_messages m
   WHERE m.org_id = v_org AND m.thread_id = p_thread
     AND NOT m.raw_transcript AND m.visibility_scope IS NULL
     AND m.body !~ '^[\s ​　﻿]*$'
     AND (p_source_refs IS NULL OR m.id = ANY (p_source_refs))
  ON CONFLICT (message_id) DO UPDATE
    SET attempts = 0, last_error = NULL, locked_at = NULL, next_attempt_at = now(), enqueued_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$$;
REVOKE ALL ON FUNCTION kg_extraction_requeue_thread(text, text[], integer, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION kg_extraction_requeue_thread(text, text[], integer, integer) TO app_rw;
  END IF;
END
$$;

SELECT kernel_apply_org_freeze_policies();
