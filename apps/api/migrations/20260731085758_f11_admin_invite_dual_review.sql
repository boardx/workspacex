-- F11 (phase-01 / UC-1.6 R10 / contracts/org-admin `ReviewAdminInvite` `MutateTeam`
--       `RemoveOrgMember` + 配额硬阻断)。建在 F10（0022）之上，不重开新地基。
--
-- 三件事，三段：
--
--   ① org_invites 加 reviewed_by / reviewed_at —— 双人复核（O-28 ⑥）的落点。
--      I-4：reviewed_by <> invited_by，CHECK 与应用层各判一次（防线，不是重复权威）。
--   ② organizations 加 seat_quota —— 配额硬阻断（I-9）。⚠ 用掉了多少座位不额外存一份
--      账本：usedSeats = count(org_memberships) + count(未失效 org_invites)，
--      理由见 pg-org-invite-repository.ts 新增小节——账本与成员表/邀请表两处计数，
--      任何一处漏更新就会漂移；数出来的数永远和真相一致，没有第二个真相源需要同步。
--   ③ teams 加 (org_id, name) 唯一索引 —— O-29 ④「组织内名称唯一」+ create 幂等重放
--      （同名返回既有 team）的落点。
--
-- ⚠ 没有第四件：移除成员**不**新建"已离职名册"表。I-8 只要求 Session 吊销 + pending
-- 邀请转 revoked + 历史产出的 authorId 不变，三者都不需要新表。org_memberships 那一行
-- 被删除即"停用访问"；credentials 行与历史产出（artifacts/provenance 等）分毫不动，
-- 这就是 attribution 保留的字面意思——署名从未在别处存过第二份，也不需要在这里再存一份。
--
-- Replayable：ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DO $$ 里判存在再加约束，
-- migrate:check 会忽略版本表重放每个文件。

/* ─────────────────────── ① 双人复核 ─────────────────────── */

ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE org_invites ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_invites_reviewer_not_inviter'
  ) THEN
    ALTER TABLE org_invites
      ADD CONSTRAINT org_invites_reviewer_not_inviter
      CHECK (reviewed_by IS NULL OR reviewed_by <> invited_by);
  END IF;
END
$$;

-- 「谁批的」与「什么时候批的」一起动或都不动——同 org_invites_used_is_atomic 的理由：
-- 少一半的行不是更严格的状态，是审计问「谁批准了这条邀请」时没有答案的状态。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_invites_reviewed_is_atomic'
  ) THEN
    ALTER TABLE org_invites
      ADD CONSTRAINT org_invites_reviewed_is_atomic
      CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
  END IF;
END
$$;

/* ─────────────────────── ② 配额硬阻断 ─────────────────────── */

-- 默认 0："组织未分配额度"是缺省状态，不是需要显式关闭的例外（O-29 ⑤ / I-9）。
-- 平台运营方线下分配（与 O-29 ①「邀请码线下签发」同一条治理取向）；本轮**没有**自服务的
-- 调整端点——usecases.md 只写了「响应带 [调整] 入口标识」，没有写「这条路由自己能改额度」。
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seat_quota integer NOT NULL DEFAULT 0;

/* ─────────────────────── ③ 团队增删改 ─────────────────────── */

-- O-29 ④「组织内名称唯一」；create 同名返回既有 team 的幂等重放靠它撞出 23505。
CREATE UNIQUE INDEX IF NOT EXISTS teams_org_name_uniq ON teams (org_id, name);
