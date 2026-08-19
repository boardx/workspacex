-- F962（design-delta `skill-sandbox-execution` §6.1）：试跑转异步的存储层。
--
-- ## ⚠ 为什么是**新表**，不是复用 `agent_runs`
--
-- contract §6.1 说「走既有 `AgentRun` 那套提交 → 轮询**形态**」。这里逐字取「形态」
-- （queued/running/终态 + `FOR UPDATE SKIP LOCKED` 认领 + kick + GET 轮询），
-- 而**不是**往 `agent_runs` 里塞行。理由是那张表的模式不允许：
--
--   agent_runs.thread_id        text NOT NULL REFERENCES chat_threads(id)
--   agent_runs.input_message_id text NOT NULL REFERENCES chat_messages(id)
--   UNIQUE (org_id, input_message_id)
--
-- 试跑**既没有对话线程、也没有聊天消息**（`trial-run-skill.ts` 头注：「试跑 ≠ 私聊」，
-- 它连 history 都恒传 `[]`）。要复用就得为每次试跑伪造一个 chat_thread + chat_message ——
-- 那些行会**真的出现在用户的对话列表里**，或者需要在每个读路径上加「排除伪造线程」的
-- 过滤器。前者是数据污染，后者是把一条谎言散布到 N 个查询里。
--
-- ⇒ 复用**形态**，不复用**行**。两张表各自诚实。
--
-- ## 失败也入库 —— 这与 `skills.ts` 里 TrialRun 的「失败不入库」不矛盾
--
-- 那句话说的是「TrialRun **这个实体**只描述成功」，现在仍然成立（失败由
-- `getTrialRun.out.failure` 承载）。但转异步之后，失败**必须**落库：调用方是轮询拿
-- 结果的，如果失败不留痕，一次失败的试跑在轮询端与「还在跑」**无法区分**，
-- 前端只能一直转圈。这是同步实现里不存在的新约束。
--
-- RLS/tenant 纪律照抄 20260818150000_uc73_sticky_revisions.sql。可独立重放。

CREATE TABLE IF NOT EXISTS skill_trial_runs (
  id             text        PRIMARY KEY,
  org_id         text        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 提交人。⚠ 轮询可见性按它判定：只有提交者能读自己的试跑（试跑是个人预演，
  -- 不是组织共享资源），越权一律裸 404，不给存在性预言机。
  actor_id       text        NOT NULL,
  version_id     text        NOT NULL,
  sample_input   text        NOT NULL,
  status         text        NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),

  -- ── 成功面 ─────────────────────────────────────────────
  output         text,
  duration_ms    integer,
  tokens         integer,
  -- 产物引用（§5：落 ObjectStore，**不自动落成项目产物**）。
  -- jsonb 数组，元素形如 { name, mime, sizeBytes, objectKey }。
  artifacts      jsonb       NOT NULL DEFAULT '[]'::jsonb
                             CHECK (jsonb_typeof(artifacts) = 'array'),

  -- ── 失败面（§6.2 三个新码 + 既有两个）────────────────────
  failure_code   text        CHECK (failure_code IS NULL OR failure_code IN (
                               'MODEL_UNAVAILABLE', 'DEPENDENCY_UNAVAILABLE',
                               'SANDBOX_UNAVAILABLE', 'SANDBOX_TIMEOUT',
                               'SCRIPT_FAILED_AFTER_RETRIES')),
  -- ⚠ 最后一次执行的**真实 stderr 原文**。不许写成「请重试」之类的加工文案（#660）。
  failure_stderr text,
  -- §7 实际发生的脚本执行次数，上限 3。
  attempts       integer     NOT NULL DEFAULT 0,

  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,

  -- 终态必须携带它该有的东西：成功要有 output，失败要有 failure_code。
  -- ⚠ 放在数据库而不是应用层：一个「succeeded 但 output 为 NULL」的行会让轮询端
  --   永远解释不清，而这种行一旦写进去就再也没人发现。
  CONSTRAINT skill_trial_runs_terminal_shape CHECK (
    (status <> 'succeeded' OR output IS NOT NULL) AND
    (status <> 'failed'    OR failure_code IS NOT NULL)
  )
);

-- 认领队列用：按 (org, status, created_at) 取最老的 queued。
CREATE INDEX IF NOT EXISTS skill_trial_runs_claim_idx
  ON skill_trial_runs (org_id, status, created_at, id);

-- 轮询读用。
CREATE INDEX IF NOT EXISTS skill_trial_runs_actor_idx
  ON skill_trial_runs (org_id, actor_id, created_at, id);

ALTER TABLE skill_trial_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_trial_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skill_trial_runs_tenant ON skill_trial_runs;
CREATE POLICY skill_trial_runs_tenant ON skill_trial_runs
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- ⚠ 不给 DELETE：试跑记录没有删除路径（同 canvas_sticky_revisions 的纪律，
--   不可变性由 grant 层面保证，不靠应用自觉）。
GRANT SELECT, INSERT, UPDATE ON skill_trial_runs TO app_rw;

COMMENT ON TABLE skill_trial_runs IS
  'F962（design-delta skill-sandbox-execution §6.1）：试跑转异步的提交→轮询存储。'
  '刻意不复用 agent_runs —— 那张表的 thread_id/input_message_id 是 NOT NULL FK 指向 '
  'chat_threads/chat_messages，而试跑既无线程也无消息，复用就得伪造聊天行并污染用户的对话列表。';

SELECT kernel_apply_org_freeze_policies();
