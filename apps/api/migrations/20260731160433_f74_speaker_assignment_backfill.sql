-- F74: 结束后指派说话人 —— 声道↔人映射记录（独立实体）+ 全量回填可撤销
-- (contracts/recording/domain.md I-9 / I-10 / I-11 / I-12，contracts/recording/usecases.md
--  「三、说话人指派」，uc-5-2 R3/R7，contracts/recording/design-signoff.md 第①②节)
--
-- ## 这个文件在防什么
--
--   · I-10「真名不冗余进 Segment 行」—— `segments` 表（尚未建，见下）**没有** `person_id` /
--     `person_name` 列，本迁移也**不加**。声道↔人映射只存在这一张表里，任何消费方
--     （引述/洞察/报告/图谱）要知道"这个声道是谁"，只能查这张表，不能查自己的缓存副本
--     ——这正是应用层 `resolveSpeaker`（`domain/recording/speaker-assignment.ts`）读的
--     唯一事实来源，也是"撤销后全部回填处同步退回出处待补"能一次到位的**数据结构原因**：
--     没有第二份副本可以忘记清空。
--
--   · I-11「回填是指向同一条映射记录的引用，不是复制副本」—— 撤销（`revoked_at`）不删行，
--     只翻一个时间戳；`(session_id, channel_id) WHERE revoked_at IS NULL` 的部分唯一索引
--     保证"同一时刻至多一条生效映射"，`channel_version` 让乐观并发（E3
--     `CHANNEL_VERSION_CHANGED`）可以在撤销后继续从上一次的版本号往上加，
--     而不是退回 0（否则两个不同世代的 `expectedChannelVersion: 0` 会互相打架，
--     见 `tests/rec/assign-backfill-revocable.test.ts` 的反证用例）。
--
--   · I-9 / I-12「候选人只来自本场在场名单，无跨场次声纹比对」—— 这条不是数据库能守住的
--     不变量（候选人列表根本不落这张表），机械落点在
--     `tests/rec/candidate-from-onsite-roster-only.test.ts` 的纯函数签名检查
--     （`deriveCandidates` 没有第二个可以传入跨场次数据的参数）。本迁移只负责
--     "指派结果落库"这一半。
--
-- ## 这个文件刻意**没有**做的事
--
--   · 没有建 `recording_sessions` / `recording_channels` / `segments`（转写段）表——
--     F69 的 `application/recording/ports.ts` 头部注释写明这些表由 F70–F73 的落地顺序决定,
--     本 feature 尚未轮到它们建。`session_id` / `channel_id` 因此是**裸文本列**,
--     没有外键——等那几张表建好后应当补外键（不在本 feature 范围内,留给后续迁移）。
--   · 没有把销毁声纹 embedding（O-14 / F75）放进这个文件——那是另一条硬约束
--     （7 天兜底销毁，级联失效),属于 F75,本迁移不越界实现。
--
-- 可重放：全部 IF NOT EXISTS / DO $$ IF NOT EXISTS,`migrate:check` 会强制重放每个文件。

/* ═══════════════ 一、`speaker_assignments`：声道↔人映射的唯一事实来源 ═══════════════ */

CREATE TABLE IF NOT EXISTS speaker_assignments (
  id               text PRIMARY KEY,
  org_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  session_id       text NOT NULL,
  channel_id       text NOT NULL,
  person_id        text NOT NULL,

  -- 乐观并发版本：跟着"这个声道被写过多少次"走，不跟着"当前是否生效"走。
  -- 撤销之后重新指派同一声道,版本号从撤销时的值继续往上加(见文件头 I-11 说明)。
  channel_version  integer NOT NULL,

  assigned_at      timestamptz NOT NULL DEFAULT now(),
  assigned_by      text NOT NULL,

  -- `NULL` = 仍生效。撤销不删行——审计轨迹与"历史不可篡改,只是不再生效"都要求这条记录
  -- 继续可查(uc-5-2 R7 收口:"每一次指派与撤销都记录谁把哪个声道绑到了谁、什么时候")。
  revoked_at       timestamptz,
  revoked_by       text,
  revoked_reason   text,

  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- 同一时刻同一声道至多一条生效映射——`CHANNEL_ALREADY_ASSIGNED` 的数据层表述。
-- 部分唯一索引(WHERE revoked_at IS NULL)而不是普通唯一约束,因为"同一声道被指派过又被
-- 撤销、之后再指派给别人"必须合法——这正是 AC1"能撤销"的前提,不能被一张只认
-- (session_id, channel_id) 的普通唯一约束挡死。
CREATE UNIQUE INDEX IF NOT EXISTS speaker_assignments_active_channel_uniq
  ON speaker_assignments (org_id, session_id, channel_id)
  WHERE revoked_at IS NULL;

-- 乐观并发校验与"本声道最近一条记录"查询的复合索引(latestFor 端口方法读这个)。
CREATE INDEX IF NOT EXISTS speaker_assignments_channel_idx
  ON speaker_assignments (org_id, session_id, channel_id, channel_version DESC);

-- 撤销审计与"某人被指派过哪些声道"的查询路径。
CREATE INDEX IF NOT EXISTS speaker_assignments_person_idx
  ON speaker_assignments (org_id, person_id);

COMMENT ON TABLE speaker_assignments IS
  'F74: 匿名声道(speakerChannelId, F70)↔真人(personId)的映射记录, 独立实体, '
  '被引述/洞察/报告/图谱共同引用(指针, 不是复制副本, I-10/I-11)。'
  'segments 表不得有 person_id/person_name 列——真名只在这里。';

COMMENT ON COLUMN speaker_assignments.channel_version IS
  '乐观并发版本, 跟随"该声道被写过多少次"单调递增, 撤销不重置——'
  '见 tests/rec/assign-backfill-revocable.test.ts 的撤销后重指派反证。';

/* ═══════════════ 二、RLS：与其余租户表同一条规则 ═══════════════ */

ALTER TABLE speaker_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE speaker_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS speaker_assignments_tenant ON speaker_assignments;
CREATE POLICY speaker_assignments_tenant ON speaker_assignments
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
