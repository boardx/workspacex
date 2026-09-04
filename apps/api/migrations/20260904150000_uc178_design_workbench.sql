/*
 * UC-17.8 Sprint 3 · B4.2 —— PM 设计工作台真栈化：`design_projects` +
 * `design_project_chat_messages` + `product_feedback` ↔ `design_projects` 双向关联。
 *
 * 契约：`packages/contracts/src/design-workbench.ts`（`DesignProject`、六条 `operations`）。
 * 需求：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md` §B4。
 * 范式来源：`20260904130100_uc178_feedback_drafts.sql`（per-org RLS + owner 谓词写法）。
 *
 * ## 可见性口径：**组织内全员可读，仅 owner 可改/删/推送**（契约头注【待确认点 1】）
 *
 * 与 `product_feedback_drafts`（提交人私有，RLS 之外再靠 SQL `owner_id = $n` 收紧到仅 owner）
 * 不同的地方只有一处：这里的「仅 owner」只对 UPDATE/DELETE/追加对话/推送生效，SELECT 对整个
 * 组织放行。本仓 RLS 的既有结论（见 `product_feedback_drafts` 迁移头注引 `0023-f31-files-
 * browser.sql`）是：per-org 表的 RLS 只按 `app.current_org` 判——没有一条按请求者 userId 收紧
 * 的会话变量（`app.current_org` 是唯一在每次请求里被设置的租户上下文）。所以这里同样只建
 * **一条**按 org 判的 RLS 策略（覆盖 SELECT/INSERT/UPDATE/DELETE 全部四种操作），
 * 「仅 owner」这条**在仓储的每一条 UPDATE/DELETE/chat 追加 SQL 里用 `owner_id = $n` 谓词表达**
 * ——同草稿先例，不是遗漏 RLS，是这条规则本来就不该也不能由 RLS 表达。
 *
 * ## 对话是一张表，不是一列 jsonb（与草稿的 `chat jsonb` 相反）
 *
 * 任务书 B4.2 明确要求「`design_project_chat_messages` 表：每项目独立历史……追加写、只读」。
 * 与草稿的 `chat jsonb` 选择不同（草稿的对话会被"编辑覆盖"之外的路径整体重写、且草稿短命），
 * 这里的对话**只追加**、伴随项目整个生命周期，用子表 + append-only 触发器（同
 * `product_feedback_status_events` 的写法）比每次追加都要"读整个 jsonb 数组、拼接、整体写回"
 * 更直接，也让`design_project_chat_messages_project_idx` 能按项目单独扫描，不必每次都读出
 * 全部历史再在应用层过滤。
 *
 * ## 双向关联：一对外键 + 唯一约束，不存两份「关联了谁」
 *
 * 契约头注逐字：`DesignProject.linkedFeedbackId` 与 `InboxItem.resolvedByDesignId` 是**同一个
 * 概念在两侧的镜像**，不是两份独立事实——它们在两张表里各自持有**方向相反**的外键：
 *
 *   · `design_projects.linked_feedback_id`   —— 方案 → 反馈（`createProject` 时写入，来自
 *     "用 PM 设计工作台深化"那条反馈；B4.4 的写入路径，本迁移只建列）。
 *   · `product_feedback.resolved_by_design_id` —— 反馈 → 方案（`pushToInbox` 时写入，且带
 *     `UNIQUE`——契约逐字「一条反馈最多关联一个方案」）。
 *
 * 两列不是同一份数据的两次存储：`linked_feedback_id` 记的是"这个方案打哪条反馈来"（项目创建
 * 时就确定，此后不变），`resolved_by_design_id` 记的是"这条反馈被哪个方案解决了"（推送时才
 * 确定，只有真正推送过的方案才会被填上）。一个方案可以"源自"某条反馈但从未推送
 * （`linked_feedback_id` 非空、对应反馈的 `resolved_by_design_id` 仍是 null）——这不是漂移，
 * 是两个不同时刻发生的两件事。**会漂移的唯一场景**是"同一条反馈的 `resolved_by_design_id`
 * 指向 A 方案，而 A 方案的 `linked_feedback_id` 却不指向这条反馈"——B4.3 的 `pushToInbox`
 * 用例保证不产生这种行（推送时只回写 `linkedFeedbackId` 指向的那条反馈，两个方向的写在同一次
 * `withTenant` 调用、同一个数据库事务里完成，见 `pg-design-project-repository.ts` 的
 * `pushToInbox` 方法），迁移层面只提供 FK + UNIQUE 兜底"指向的行必须存在、一条反馈不会被两个
 * 方案同时认领"。
 *
 * ⚠ `product_feedback.resolved_by_design_id` **不**加入 `fb2_product_feedback_immutable_
 *   columns()` 的不可变列名单——同该函数里 `github_issue_url` 的先例（"故意不在名单里"）：
 *   它是推送这个副作用允许写回的列，而不是提交时就定型的历史事实。函数本身不需要改
 *   （新列默认不在名单里就是"可变"，见该函数在 `20260904130000` 里的最近一次
 *   `CREATE OR REPLACE`，逐列列出的名单本迁移不重复不新增）。
 *
 * Replayable：IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS，重放安全。
 */

CREATE TABLE IF NOT EXISTS design_projects (
  id                 text PRIMARY KEY,
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- 项目的创建者/负责人。不加 FK 到 credentials，同 product_feedback.submitted_by /
  -- product_feedback_drafts.owner_id：账号清理不该让历史项目消失或级联删除。
  owner_id           text NOT NULL,

  name               text NOT NULL CHECK (btrim(name) <> ''),
  template           text NOT NULL CHECK (template IN ('mobile', 'ui', 'wireframe')),
  -- 背景/上下文。允许空字符串——新建时未填，不是 NULL（同 FeedbackDraft.detail 的写法）。
  problem            text NOT NULL DEFAULT '',

  -- 服务端按 DESIGN_PROJECT_INITIAL_CRITERIA / DESIGN_PROJECT_INITIAL_FRAMES 填入的**快照**
  -- （契约头注：将来默认文案改版，已创建项目的验收标准不应该跟着变）。
  criteria           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(criteria) = 'array'),
  frames             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(frames) = 'array'),

  pushed             boolean NOT NULL DEFAULT false,
  pushed_at          timestamptz NULL,
  -- `pushToInbox.in.note`——收件箱条目那侧的说明，upsert 语义下随每次推送覆盖（见契约
  -- `pushToInbox` 头注「推送幂等选的是 upsert」）。`inbox.ts` 的 `InboxItem` 今天没有独立的
  -- "note" 投影位；B4.3 用它做 design 条目的 `body`（回退到 problem，见 inbox-projection.ts）。
  push_note          text NULL,

  -- 方案 → 反馈：本项目是否深化自某条反馈。B4.4（POST /feedback/:id/deepen）写入，
  -- 本迁移只建列。ON DELETE SET NULL——源反馈被删（组织整体删除的级联之外，反馈本身不会被
  -- 硬删,但这里不假设"永不为空"）不应该级联删掉已经产出的设计方案。
  linked_feedback_id text NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_projects_org_created_idx
  ON design_projects (org_id, created_at DESC);

/* 「我的设计项目」按名称过滤是应用层过滤（listMyProjects 的 owner 是用户视角，不是可见性边界），
   但列表仍然按 org 取全部——一次索引服务两种读法（全组织 / owner 子集）。 */
CREATE INDEX IF NOT EXISTS design_projects_owner_idx
  ON design_projects (org_id, owner_id, updated_at DESC);

/* 收件箱聚合（B4.3 `list-inbox.ts`）只关心已推送的项目，且按创建顺序编号（D-n）。 */
CREATE INDEX IF NOT EXISTS design_projects_pushed_idx
  ON design_projects (org_id, created_at ASC) WHERE pushed;

CREATE TABLE IF NOT EXISTS design_project_chat_messages (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES design_projects (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user', 'ai')),
  -- 契约 DesignProjectChatTurn.text.min(1)：一条空消息没有信息量。
  text       text NOT NULL CHECK (btrim(text) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

/* 每项目独立历史的唯一查询：按项目、创建顺序取全部（契约没有分页/独立查询口，见 design-
   workbench.ts 头注「本文件刻意没有的东西」）。 */
CREATE INDEX IF NOT EXISTS design_project_chat_messages_project_idx
  ON design_project_chat_messages (org_id, project_id, created_at ASC);

/* 追加写、只读——同 product_feedback_status_events 的 append-only 写法。 */
CREATE OR REPLACE FUNCTION dw_chat_messages_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'design_project_chat_messages are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS design_project_chat_messages_append_only_trg ON design_project_chat_messages;
CREATE TRIGGER design_project_chat_messages_append_only_trg
  BEFORE UPDATE OR DELETE ON design_project_chat_messages
  FOR EACH ROW EXECUTE FUNCTION dw_chat_messages_append_only();

/* ── 双向关联：一对外键 + 唯一约束（见文件头）── */

ALTER TABLE design_projects
  DROP CONSTRAINT IF EXISTS design_projects_linked_feedback_fkey;
ALTER TABLE design_projects
  ADD CONSTRAINT design_projects_linked_feedback_fkey
    FOREIGN KEY (linked_feedback_id) REFERENCES product_feedback (id) ON DELETE SET NULL;

ALTER TABLE product_feedback
  ADD COLUMN IF NOT EXISTS resolved_by_design_id text NULL;
ALTER TABLE product_feedback
  DROP CONSTRAINT IF EXISTS product_feedback_resolved_by_design_fkey;
ALTER TABLE product_feedback
  ADD CONSTRAINT product_feedback_resolved_by_design_fkey
    FOREIGN KEY (resolved_by_design_id) REFERENCES design_projects (id) ON DELETE SET NULL;
-- 「一条反馈最多关联一个方案」（契约 `pushToInbox` 头注逐字）。
ALTER TABLE product_feedback
  DROP CONSTRAINT IF EXISTS product_feedback_resolved_by_design_uniq;
ALTER TABLE product_feedback
  ADD CONSTRAINT product_feedback_resolved_by_design_uniq UNIQUE (resolved_by_design_id);

CREATE INDEX IF NOT EXISTS product_feedback_resolved_by_design_idx
  ON product_feedback (org_id, resolved_by_design_id) WHERE resolved_by_design_id IS NOT NULL;

/* ── RLS：per-org，全员读写（「仅 owner」在仓储 SQL 谓词里，不在这里）── */

DO $$
BEGIN
  EXECUTE 'ALTER TABLE design_projects ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE design_projects FORCE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE design_project_chat_messages ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE design_project_chat_messages FORCE ROW LEVEL SECURITY';
END
$$;

DROP POLICY IF EXISTS design_projects_tenant ON design_projects;
CREATE POLICY design_projects_tenant ON design_projects
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

DROP POLICY IF EXISTS design_project_chat_messages_tenant ON design_project_chat_messages;
CREATE POLICY design_project_chat_messages_tenant ON design_project_chat_messages
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON design_projects FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON design_projects TO app_rw;

REVOKE ALL ON design_project_chat_messages FROM app_rw;
-- 追加写、只读：没有 UPDATE/DELETE 授权,与触发器双重把关（同 product_feedback_status_events）。
GRANT SELECT, INSERT ON design_project_chat_messages TO app_rw;

SELECT kernel_apply_org_freeze_policies();
