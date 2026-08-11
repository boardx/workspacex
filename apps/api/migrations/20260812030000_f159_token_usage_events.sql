/*
 * F159 —— token 计量的唯一事实源 `token_usage_events`。
 *
 * ## 为什么需要一张新表
 *
 * 2026-08-12 实测（SHA 54d9e340）：全仓**零** token 计量落库。`agent_runs` 有
 * `model_provider` / `model_id` 却没有任何 token 列；`agent_run_steps` 有 `model_called`
 * 这一步，也没有。而 `infrastructure/agent-run/configured-model-provider.ts` **早就**
 * 从上游 `usage.total_tokens` 解出了数字并经 `complete()` / `completeStream()` 返回
 * `{ text, tokens }`——`execute-run.ts` 拿到后直接丢掉。后台「成员与配额 / 用量监控」
 * 两屏因此只能读 mock。本迁移是把那个已经拿到手的数记下来的地方。
 *
 * ## 为什么不是 `agent_runs` 加一列
 *
 * 一次 run 可能调用模型不止一次（#709 的历史摘要就复用 `deps.model.complete` 再调一次），
 * 而配额与用量监控要回答的是「这个组织这周烧了多少 token」，不是「这次 run 烧了多少」。
 * 一次 run 一列会在第二次调用发生时静默丢掉一半事实。事件流才是对的形状。
 *
 * ## 三条刻意的取舍（都在 design-delta 里等人类签，见 §1.1）
 *
 * ① **`tokens_prompt` / `tokens_completion` 可空**，与 `tokens_total` 并存。
 *    coord-main 2026-08-12 裁决③要我先查一步再定：实测 `configured-model-provider.ts`
 *    打的是 OpenAI 兼容接口，`usage` 对象**本来就带** `prompt_tokens` / `completion_tokens`
 *    ——是我们的解析类型只声明了 `total_tokens`，把另外两个丢在了线上。既然上游给得到，
 *    现在加列几乎零成本，回头补迁移贵。⇒ 原具名缺口 `GAP-TOKEN-IO-SPLIT` **撤销**。
 *    ⚠ 仍然可空：不是每个 provider 都报（DeepResearch / Bailian 这些自研包装可能没有）。
 *    **NULL = 上游没报，不是 0**——填 0 会让「没报」在报表上等于「一个 prompt token 都没用」。
 * ② **失败的调用也记一行**。管理员问「他这周怎么用了这么多」时失败重试是答案的一部分；
 *    「失败就没有用量」还会让本表行数与 `agent_runs` 对不上，而对不上时没人分得清是漏记
 *    还是真没调用。
 *    ⚠ **失败行的 token 不再强制为 0**（coord-main 裁决②的修正）：部分 4xx 上游照样计费
 *    prompt tokens 并在错误响应体里回 `usage`。上游报了就如实记，没报才记 0。
 *    代价说清楚：因此**没有**「失败必然为 0」这条机械约束了，「把成功的数写到失败分支上」
 *    这类写入点缺陷不再被数据库拦住——改由 `token-usage-single-write-path.test.ts` 断言。
 * ③ **`run_id` 可空且 ON DELETE SET NULL**。计量事实不该因为一次 run 被清理而消失——
 *    额度是按月结的，run 的生命周期比它短。
 *
 * ## Append-only，理由与 `agent_run_steps` / `agent_run_deltas` 相同
 *
 * 这是账。账不能改写，否则「本月已用 3.9M」这句话没有任何意义。同一份两半机制证据：
 * GRANT 面只给 SELECT/INSERT，加 BEFORE UPDATE OR DELETE 触发器；父组织删除时的级联
 * 是生命周期清理不是调用方改写，沿用同一个豁口。
 *
 * Replayable：全部 IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS，重放安全。
 */

CREATE TABLE IF NOT EXISTS token_usage_events (
  id             text PRIMARY KEY,
  org_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 归属到人：配额是按人分配的，没有这一列本表就只能回答组织级问题。
  -- 不加 FK 到 credentials：免注册身份（guest identity）也可能触发模型调用，
  -- 而它们不在 credentials 里——加 FK 会让那条路径写不进来，等于漏计。
  user_id        text NOT NULL,
  run_id         text NULL REFERENCES agent_runs (id) ON DELETE SET NULL,
  model_provider text NOT NULL,
  model_id       text NOT NULL,
  tokens_total   bigint NOT NULL CHECK (tokens_total >= 0),
  -- NULL = 上游没报这一维，**不是 0**。见文件头 ①。
  tokens_prompt     bigint NULL CHECK (tokens_prompt IS NULL OR tokens_prompt >= 0),
  tokens_completion bigint NULL CHECK (tokens_completion IS NULL OR tokens_completion >= 0),
  outcome        text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  occurred_at    timestamptz NOT NULL DEFAULT now()
);

/* 用量监控的四个窗口聚合、配额屏的「本月已用」都走这条：按组织 + 时间倒序，
   人与模型作为覆盖列，避免为每个窗口各建一条索引。 */
CREATE INDEX IF NOT EXISTS token_usage_events_org_time_idx
  ON token_usage_events (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS token_usage_events_org_user_time_idx
  ON token_usage_events (org_id, user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION f159_token_usage_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'token usage events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS token_usage_events_append_only_trg ON token_usage_events;
CREATE TRIGGER token_usage_events_append_only_trg
  BEFORE UPDATE OR DELETE ON token_usage_events
  FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();

ALTER TABLE token_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS token_usage_events_tenant ON token_usage_events;
CREATE POLICY token_usage_events_tenant ON token_usage_events
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON token_usage_events FROM app_rw;
GRANT SELECT, INSERT ON token_usage_events TO app_rw;

SELECT kernel_apply_org_freeze_policies();
