-- Generated and static interview experts share one complete, durable profile shape.
ALTER TABLE digital_interview_expert_candidates
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '未分类',
  ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '暂无简介',
  ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '未指定',
  ADD COLUMN IF NOT EXISTS typical_advice text NOT NULL DEFAULT '暂无典型建议',
  ADD COLUMN IF NOT EXISTS age integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS occupation text NOT NULL DEFAULT '未指定',
  ADD COLUMN IF NOT EXISTS goals text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pain_points text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS motivations text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS influences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS personality_traits jsonb NOT NULL DEFAULT '{"introvertExtrovert":5,"analyticalCreative":5,"busyTimeRich":5}'::jsonb,
  ADD COLUMN IF NOT EXISTS service_value text NOT NULL DEFAULT '暂无服务价值说明';

ALTER TABLE digital_interview_expert_snapshots
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '未分类',
  ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '暂无简介',
  ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '未指定',
  ADD COLUMN IF NOT EXISTS typical_advice text NOT NULL DEFAULT '暂无典型建议',
  ADD COLUMN IF NOT EXISTS age integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS occupation text NOT NULL DEFAULT '未指定',
  ADD COLUMN IF NOT EXISTS goals text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pain_points text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS motivations text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS influences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS personality_traits jsonb NOT NULL DEFAULT '{"introvertExtrovert":5,"analyticalCreative":5,"busyTimeRich":5}'::jsonb,
  ADD COLUMN IF NOT EXISTS service_value text NOT NULL DEFAULT '暂无服务价值说明';
