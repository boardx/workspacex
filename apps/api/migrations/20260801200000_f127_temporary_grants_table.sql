-- F127: `temporary_grants` 独立表 —— 按议程环节临时提权的存储层
-- (uc-1-4 R4 / uc-00-3 R3 / contracts/project.ts `advanceAgendaSegment.out.revokedTemporaryGrants`)
--
-- ## 这个文件在补哪个洞
--
-- F05 交付了临时提权的判定逻辑（`domain/identity/temporary-grant.ts` / `grant-temporary-read.ts` /
-- `check-temporary-grant-access.ts`），但其 `temporary-grant-ports.ts` 头部写明：故意没有建这张表——
-- 「建立即是做 F127 的交付物」。`advance-agenda-segment.ts` 因此把 `revokedTemporaryGrants`
-- 恒定为 0，并在头部把这条缺口报给 F127（`grep` 全仓找不到任何 `temporary_grant` 相关的表）。
-- 本迁移把这张表建出来，是 F127 唯一新增的一张表。
--
-- ⚠ 提权是在既有项目角色**之上追加**，不是换一个角色——本表不改、也不引用
--   `project_memberships.project_role`，见 `temporary-grant.ts` 文件头「不是第五个项目角色」一节。
--
-- ⚠ 失效条件是**流程节点不是时间点**：本表没有 `expires_at` 时间戳列，只有一个指向
--   `agenda_segments` 的外键——「是否还有效」永远由查询时该环节的当前 `state` 决定
--   （`evaluateTemporaryGrant` / 本 feature 对 `advanceAgendaSegment` 的收回逻辑），不是
--   跟这一行本身的某个到期字段比较。
--
-- ## 序号
-- 时间戳前缀（同 F118/F124 等 phase-01 迁移的理由）：多个 worker 并行认领不同 feature 时，
-- 顺序数字会互相撞号。

CREATE TABLE IF NOT EXISTS temporary_grants (
  id     text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

  -- 工作坊机件（同 `agenda_segments` 的理由：超类型模型下 workshops.id ≡ projects.id）。
  workshop_id text NOT NULL,

  granter_id text NOT NULL,
  grantee_id text NOT NULL,

  -- `TemporaryGrantScope`：一个读动作 + 可选的组作用域（`domain/identity/temporary-grant.ts`
  -- `TemporaryGrantScope`）。`group_id` 为 NULL = 覆盖该动作的全部组，不是「未设置」。
  action   text NOT NULL,
  group_id text,

  -- 失效条件锚定的流程节点——本表唯一的「什么时候失效」判据来源，见文件头。
  agenda_segment_id text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- null = 仍然存活。恰好被置一次，在过期首次被观察到的那次（读侧的
  -- `checkTemporaryGrantAccess`，或写侧 `advanceAgendaSegment` 状态机变更时主动收回，
  -- 两条路径共用同一个 `markRevoked`，见 `temporary-grant-ports.ts`）。
  revoked_at     timestamptz,
  revoked_reason text
    CONSTRAINT temporary_grants_revoked_reason_check
    CHECK (revoked_reason IS NULL OR revoked_reason IN ('agenda-segment-terminal')),

  -- 「已收回」与「收回原因」必须同生同灭——不允许一行只填了其中一个。
  CONSTRAINT temporary_grants_revoked_pair_check
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'temporary_grants_segment_workshop_org_fkey' AND conrelid = 'temporary_grants'::regclass
  ) THEN
    ALTER TABLE temporary_grants
      ADD CONSTRAINT temporary_grants_segment_workshop_org_fkey
      FOREIGN KEY (agenda_segment_id, workshop_id, org_id)
      REFERENCES agenda_segments (id, workshop_id, org_id);
  END IF;
END $$;

-- `advanceAgendaSegment` 的收回路径按 `(org_id, workshop_id, agenda_segment_id)` 找出该环节
-- 全部仍存活的 grant（`findActiveBySegment`）——这是它唯一的查询形状，见
-- `application/identity/temporary-grant-ports.ts`。
CREATE INDEX IF NOT EXISTS temporary_grants_segment_idx
  ON temporary_grants (org_id, workshop_id, agenda_segment_id) WHERE revoked_at IS NULL;

-- `checkTemporaryGrantAccess` / `grantTemporaryRead` 的 `findActive` 按被授权人 + 动作找出
-- 那一条仍存活的 grant——见 `temporary-grant-ports.ts` 头部「至多一行」的构造性保证。
CREATE INDEX IF NOT EXISTS temporary_grants_grantee_idx
  ON temporary_grants (org_id, grantee_id, action) WHERE revoked_at IS NULL;

ALTER TABLE temporary_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporary_grants FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS temporary_grants_tenant ON temporary_grants;
CREATE POLICY temporary_grants_tenant ON temporary_grants
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON temporary_grants FROM app_rw;
-- 无 DELETE：收回是 UPDATE（`revoked_at`/`revoked_reason` 置值），本束没有删除 grant 行的操作。
GRANT SELECT, INSERT, UPDATE ON temporary_grants TO app_rw;

-- 新建的租户表需要显式触发一次 F22 的三条 RESTRICTIVE 冻结策略重算——
-- `kernel_apply_org_freeze_policies()` 只在被调用时才重算（同 0018/20260731085808 等迁移
-- 的最后一步）。漏了这一行的表现是：新库上 `temporary_grants` 没有冻结，
-- 只有 `migrate:check` 的强制重放会报「重放后 schema 摘要不一致」。
SELECT kernel_apply_org_freeze_policies();

COMMENT ON TABLE temporary_grants IS
  'F127: 按议程环节临时提权的存储层。是在既有项目角色之上的追加，不是第五个项目角色'
  '（不引用 project_memberships.project_role）。失效条件锚定 agenda_segments.state 这个'
  '流程节点，不是任何时间戳——四种终结方式（advance/closeEarly/merge 落 closed，'
  'skip 落 skipped）都能让本表里对应的行被 advanceAgendaSegment 主动收回。';
