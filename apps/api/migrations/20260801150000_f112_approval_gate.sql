-- F112：批准卡后端契约（六项披露 + 三出口 + 暂停闸门 + 转后台）
-- chat 束 domain.md E 组 I-27…I-32，uc-8-2 R3 步骤 6 / R11。
--
-- ## 两张表，理由
--
-- `chat_approval_requests` 是批准闸门本身的状态机（`paused → {approved|reparamed|declined|
-- expired}`，I-29 单向且一次性）。它不是 `provenance_events` 的投影——批准请求要被
-- **原地更新**一次状态（`decideApproval`），而 `provenance_events` 是 append-only
-- （0013 头部），两者的写入模式不兼容，硬塞进同一张表意味着要么请求表变成 append-only
-- （那就没有「当前状态」这回事），要么审计表开始允许 UPDATE（破坏 0013 的不变量）。
-- 决策本身（谁批准、何时、供哪个 taskId）仍然经 `provenance.append` 写一条
-- `approval-requested` / `approval-decided`（本迁移随附的枚举追加，ADR-101 先例）——
-- 这张表只存状态机需要的「当前值」。
--
-- `chat_background_tasks` 是批准后转的后台任务。11-task（任务队列）束尚未落地
-- （issue #196 已登记的跨分片依赖），这张表是 F112 范围内的**最小占位实现**：
-- 一行状态机，供 `getBackgroundTask` 读、供审批流程写。**不是** 11-task 的替代品——
-- 11-task 落地时，真正的队列会消费/生产这张表，或者这张表被换成队列的读投影，
-- 由那时候的实现者决定，此处不预判。
--
-- 可重放：IF NOT EXISTS / DROP-then-ADD，`migrate:check` 强制重放每个文件。

/* ────────── provenance_events: +2 members（ADR-101 先例，Proposed，需人类追认）────────── */
-- 见 packages/contracts/src/provenance.ts 枚举自身注释与
-- docs/adr/ADR-101-provenance-event-type-missing-members.md 追加记录（2026-08-01，F112）。
--
-- ⚠ 时间戳排在 F98 的 20260801140000 之后（rebase 时改的，原为 130000）：ADR-101 的
-- F98 追加段落记录了一次实测反证——两条并发迁移都对 provenance_events_type_check
-- 做 DROP+ADD，"后写者说了算"，先跑的一方会丢自己刚加的成员。这里把 CHECK 的
-- IN 列表包含 F98 的 'contact-revealed'（而不是只有本 feature 的两个值），确保
-- 无论迁移器按什么顺序重放，最终落地的 CHECK 都是两边的并集，不是谁覆盖谁。

DO $$
BEGIN
  ALTER TABLE provenance_events DROP CONSTRAINT IF EXISTS provenance_events_type_check;
  ALTER TABLE provenance_events ADD CONSTRAINT provenance_events_type_check CHECK (type IN (
    'ingested', 'transformed', 'generated', 'human-edited', 'pinned', 'bound', 'unbound',
    'superseded', 'evidence-withdrawn',
    'capability-added', 'capability-updated', 'capability-disabled', 'role-changed',
    'team-changed', 'admin-project-access', 'local-export',
    'downloaded',
    'project-created', 'project-archived', 'project-unarchived', 'agenda-segment-state-changed',
    'thread-created', 'thread-renamed', 'thread-deleted',
    'integrity-check-failed',
    -- F98（Proposed，需人类追认 —— 见 20260801140000_f98_contact_reveal_audit.sql）
    'contact-revealed',
    'unauthorized-attempt',
    -- F112（Proposed，需人类追认 —— 见 ADR-101 追加记录）
    'approval-requested', 'approval-decided'
  ));
END
$$;

/* ────────── chat_approval_requests（I-27…I-32）────────── */

CREATE TABLE IF NOT EXISTS chat_approval_requests (
  id                    text PRIMARY KEY,
  org_id                text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  thread_id             text NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  agent_id              text NOT NULL,
  action                text NOT NULL CHECK (length(action) > 0),
  -- I-27：`paused` 期间目标动作副作用恒为 0——这张表本身不驱动任何目标系统写入，
  -- 只记录「有一次高影响动作被拦下」，这正是零副作用在存储层的体现：没有第二张
  -- 「已执行」标记表在 paused 状态下被写入。
  status                text NOT NULL CHECK (status IN
    ('paused', 'approved', 'reparamed', 'declined', 'expired')),
  -- 六项披露里的「调用链」——见 create-approval-request.ts 文件头登记的已知简化
  -- （契约 `createApprovalRequest.in` 不携带调用方链信息，本实现恒为 `[agentId]`）。
  call_chain            text[] NOT NULL CHECK (array_length(call_chain, 1) > 0),
  -- 六项披露里的「模型」——存的是 model registry 的 modelId 集合，不是名字或价格字面量
  -- （I-31：价格永远现读 `models` 表，不落一份快照副本，防止价格改了而旧卡片显示旧价）。
  proposed_models       text[] NOT NULL CHECK (array_length(proposed_models, 1) > 0),
  -- 六项披露里的「要读的数据及其密级」。`ApprovalDataScope` 单源在
  -- packages/contracts/src/chat.ts，这里只存契约已定形的数组，不重新声明字段。
  data_scope            jsonb NOT NULL CHECK (jsonb_array_length(data_scope) > 0),
  estimated_tokens      integer NOT NULL CHECK (estimated_tokens >= 0),
  expires_at            timestamptz NOT NULL,
  -- `[改参数再跑]` 生成的新请求 id（I-30）。仅当 status = 'reparamed' 时非空。
  superseded_by_request_id text REFERENCES chat_approval_requests (id) ON DELETE SET NULL,
  -- 改参时新请求指回原请求（I-30 "supersedesRequestId"）。仅新请求非空。
  supersedes_request_id text REFERENCES chat_approval_requests (id) ON DELETE SET NULL,
  -- approve 时创建的后台任务 id。仅当 status = 'approved' 时非空。
  task_id               text,
  decided_by            text,
  decided_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_approval_requests_thread_idx
  ON chat_approval_requests (org_id, thread_id, created_at DESC);

/* ────────── chat_background_tasks（getBackgroundTask 的最小占位实现）────────── */

CREATE TABLE IF NOT EXISTS chat_background_tasks (
  id                    text PRIMARY KEY,
  org_id                text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  approval_request_id   text NOT NULL REFERENCES chat_approval_requests (id) ON DELETE CASCADE,
  status                text NOT NULL CHECK (status IN
    ('queued', 'running', 'needs-input', 'done', 'failed', 'cancelled')),
  eta_minutes           integer NOT NULL CHECK (eta_minutes >= 0),
  result_message_id     text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_background_tasks_request_idx
  ON chat_background_tasks (org_id, approval_request_id);

/* ─────────────────────────── RLS ─────────────────────────── */

DO $$
BEGIN
  ALTER TABLE chat_approval_requests ENABLE ROW LEVEL SECURITY;
  ALTER TABLE chat_approval_requests FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS chat_approval_requests_tenant ON chat_approval_requests;
  CREATE POLICY chat_approval_requests_tenant ON chat_approval_requests
    USING (org_id = current_setting('app.current_org', true))
    WITH CHECK (org_id = current_setting('app.current_org', true));

  ALTER TABLE chat_background_tasks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE chat_background_tasks FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS chat_background_tasks_tenant ON chat_background_tasks;
  CREATE POLICY chat_background_tasks_tenant ON chat_background_tasks
    USING (org_id = current_setting('app.current_org', true))
    WITH CHECK (org_id = current_setting('app.current_org', true));
END
$$;

GRANT SELECT, INSERT, UPDATE ON chat_approval_requests TO app_rw;
GRANT SELECT, INSERT, UPDATE ON chat_background_tasks TO app_rw;

-- ⚠ 必须显式调用一次，不能指望 0014 自己扫到这两张新表——同 0019/0027/0033 等每次
-- 新增租户表的成例。
SELECT kernel_apply_org_freeze_policies();
