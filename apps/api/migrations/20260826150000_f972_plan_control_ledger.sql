-- F972 (plan-control 契约束) —— 计划账本 append-only 存储 + 孤儿约束表 + RLS。
--
-- 权威规格：phases/phase-01-run-a-project/contracts/plan-control/{domain,design-signoff}.md
-- （design-signoff.md 3.2「新表与读模型」）。本文件是那张 SQL 草图的落地，不是重新设计。
--
-- ## chat_plan_ledgers —— append-only 账本（I-1 / I-2）
--
--   revision           —— 同一 thread_id 内严格单调递增、永不重用（I-2）。任何一次写入
--                          （引擎快照或用户编辑）都产生新的一行，不就地改写——本表**没有
--                          UPDATE 路径**：没有触发器允许写，没有 GRANT UPDATE，见下方 RLS 段。
--   engine_epoch       —— 引擎侧快照的世代号（I-6）：引擎写永远接受、递增它；用户编辑不改它。
--   origin             —— 'engine' | 'user'，与 basedOnRevision 的存在性成对：
--                          仅 origin='user' 时 based_on_revision 非空（I-5 的并发前提）。
--   steps              —— PlanStep[]，jsonb，含内嵌 constraints（PlanConstraintView[]）。
--                          **没有 order/sortKey 列**——数组下标即执行顺序（I-4）。
--                          **没有 phase 列**——PlanPhase 是纯派生值，不落库（I-7）。
--   created_by         —— origin='user' 时非空；origin='engine' 时 NULL（系统写入）。
--
-- 唯一约束 (thread_id, revision) 就是 I-1「任一 threadId 恰好有一份 revision 最大的账本」
-- 的机械断言点：`SELECT thread_id FROM chat_plan_ledgers GROUP BY thread_id, revision
-- HAVING count(*) > 1` 恒空。
--
-- ## chat_plan_orphan_constraints —— 孤儿约束（I-8）
--
-- 宿主 step 在后续版本消失时，挂在其上的约束**转孤儿并对用户可见地标记，不得静默删除**。
-- 这张表与 chat_plan_ledgers 分开，是因为孤儿约束的生命周期不再随 revision 演进——
-- 它不是"当前账本的一部分"，是"曾经存在、现在需要用户看见并决定去留"的独立记录。
-- UC-6 removePlanConstraint 撤销孤儿约束时对这张表做真实 DELETE（用户主动动作，不是静默丢失）。
--
-- 可重放：IF NOT EXISTS / OR REPLACE 全程（migrate:check 忽略版本表强制重放每个文件）。

CREATE TABLE IF NOT EXISTS chat_plan_ledgers (
  thread_id          text        NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  org_id             text        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  revision           integer     NOT NULL CHECK (revision >= 0),
  engine_epoch       integer     NOT NULL CHECK (engine_epoch >= 0),
  origin             text        NOT NULL CHECK (origin IN ('engine', 'user')),
  based_on_revision  integer     NULL,
  -- I-5 的形状前提：仅 user 编辑携带 basedOnRevision，engine 快照不携带。
  CHECK ((origin = 'user') = (based_on_revision IS NOT NULL)),
  steps              jsonb       NOT NULL,
  created_by         text        NULL,
  -- I-9：origin='engine' 的行 created_by 恒 NULL（约束只可能由人产生，引擎不产出约束）。
  CHECK ((origin = 'engine') = (created_by IS NULL)),
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, revision)
);

-- getPlanLedger 的读面：按线程取 revision 最大的一行（I-1）。
CREATE INDEX IF NOT EXISTS chat_plan_ledgers_thread_revision_desc_idx
  ON chat_plan_ledgers (thread_id, revision DESC);

CREATE INDEX IF NOT EXISTS chat_plan_ledgers_org_idx ON chat_plan_ledgers (org_id);

CREATE TABLE IF NOT EXISTS chat_plan_orphan_constraints (
  constraint_id        text        PRIMARY KEY,
  thread_id            text        NOT NULL REFERENCES chat_threads (id) ON DELETE CASCADE,
  org_id               text        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  text                 text        NOT NULL,
  former_step_content  text        NOT NULL,
  orphaned_at_revision integer     NOT NULL CHECK (orphaned_at_revision >= 0),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_plan_orphan_constraints_thread_idx
  ON chat_plan_orphan_constraints (thread_id);
CREATE INDEX IF NOT EXISTS chat_plan_orphan_constraints_org_idx
  ON chat_plan_orphan_constraints (org_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'chat_plan_ledgers') THEN
    RAISE EXCEPTION 'chat_plan_ledgers did not get created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'chat_plan_orphan_constraints') THEN
    RAISE EXCEPTION 'chat_plan_orphan_constraints did not get created';
  END IF;
END
$$;

/* ─────────────────────────── append-only：无 UPDATE 路径（I-2） ───────────────────────────
 *
 * 与 provenance_events（0013-f08-provenance-audit.sql）同一纪律：REVOKE UPDATE 只挡得住
 * 走 GRANT 的角色，挡不住属主（迁移脚本 / psql 会话）。触发器对**任何角色**一视同仁地拒绝
 * UPDATE——这是"没有 UPDATE 路径"从"约定"变成"机械不可能"的唯一形状。
 * DELETE 允许：线程删除时靠 FK CASCADE 整条线程的账本一起消失，这不是"改写历史"，
 * 是"历史的持有者不存在了"，与 provenance_events 的属主级"删整个组织"同构，因此本表
 * 不需要复刻 provenance_events 那道额外的 undeletable 触发器——账本没有"删单行"这个操作面
 * （没有任何 UC 要求它），级联删除已经是唯一的删除入口。 */

CREATE OR REPLACE FUNCTION chat_plan_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'PLAN_LEDGER_APPEND_ONLY: chat_plan_ledgers row (thread_id=%, revision=%) cannot be modified (invariant I-2)',
    OLD.thread_id, OLD.revision
    USING ERRCODE = 'raise_exception',
          DETAIL  = '账本的并发纪律（I-5）依赖"每次写入都是新的一行"；就地改写会让 revision 不再是一条可信的时间线。',
          HINT    = '要修正一版账本，写一条新的 revision，不要改旧的。';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_plan_ledger_immutable_trg ON chat_plan_ledgers;
CREATE TRIGGER chat_plan_ledger_immutable_trg
  BEFORE UPDATE ON chat_plan_ledgers
  FOR EACH ROW EXECUTE FUNCTION chat_plan_ledger_immutable();

/* ─────────────────────────── RLS：按 thread_id 继承 chat_threads 的判权 ───────────────────
 *
 * design-signoff.md 3.2：「两张表都按 thread_id 继承 chat_threads 的行级策略，本束不另立
 * 一套判权」——即不重新发明可见性/写权语义（那是 chat 束 F108 UC-0 的职责），只复用同一套
 * `org_id = current_setting('app.current_org')` 租户隔离机制（本仓全部租户表的成例，见
 * thread_context_state / chat_message_attachments 等）。线程内的角色/写权判定发生在
 * application 层（委托 chat UC-0 的判定结果），不在这一层重复。 */

ALTER TABLE chat_plan_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_plan_ledgers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_plan_ledgers_tenant ON chat_plan_ledgers;
CREATE POLICY chat_plan_ledgers_tenant ON chat_plan_ledgers
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- 没有 UPDATE：账本 append-only，触发器已在任何角色层面拒绝（见上）。DELETE 只经 FK CASCADE。
REVOKE ALL ON chat_plan_ledgers FROM app_rw;
GRANT SELECT, INSERT ON chat_plan_ledgers TO app_rw;

ALTER TABLE chat_plan_orphan_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_plan_orphan_constraints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_plan_orphan_constraints_tenant ON chat_plan_orphan_constraints;
CREATE POLICY chat_plan_orphan_constraints_tenant ON chat_plan_orphan_constraints
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- 孤儿约束允许 DELETE：UC-6 撤销一条孤儿约束是用户的显式动作，不是静默丢失（I-8 挡的是
-- "宿主 step 消失时约束跟着消失"，不是挡"用户主动点了撤销"）。不允许 UPDATE——一条孤儿
-- 约束的正文是它变成孤儿那一刻的快照，不该之后被改写。
REVOKE ALL ON chat_plan_orphan_constraints FROM app_rw;
GRANT SELECT, INSERT, DELETE ON chat_plan_orphan_constraints TO app_rw;

-- 新增租户表之后必须重新调用一次组织冻结策略，否则组织冻结对这两张新表不生效
-- （同 F34/F35/F36/F153/F154 成例）。
SELECT kernel_apply_org_freeze_policies();
