-- Generated and static interview experts share one complete, durable profile shape.
ALTER TABLE digital_interview_expert_candidates
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '未分类',
  ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '暂无简介',
  ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '未指定',
  ADD COLUMN IF NOT EXISTS typical_advice text NOT NULL DEFAULT '暂无典型建议';

ALTER TABLE digital_interview_expert_snapshots
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '未分类',
  ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '暂无简介',
  ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '未指定',
  ADD COLUMN IF NOT EXISTS typical_advice text NOT NULL DEFAULT '暂无典型建议';
