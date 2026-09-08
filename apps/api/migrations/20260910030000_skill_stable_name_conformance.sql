-- #3033（第二半）：DevApp 原生运行时下 chat 全挂的现场根因之一是
--   native_invalid_skill_stable_name:sk_6574c197-…
-- `skills.stable_name` 是工具身份，契约 `StableName` 要求 `^[a-z0-9][a-z0-9-]*$`，
-- 原生 package set 规范化（`canonicalNativePackageSet`）更严：`^[a-z0-9]+(-[a-z0-9]+)*$`。
-- 两条遗留来源写进过不合规的值：
--   1. URL 导入在 2026-09-07 之前直接拿内部 id `sk_<uuid>` 当 stable_name（下划线）；
--   2. 之后的 slugify 对非 ASCII 展示名原样保留（中文名 → 中文 stable_name）。
-- 一旦这样的 skill 被启用/挂载，该组织每一条原生 run 在调模型前就失败。
-- 本迁移幂等：只改不合规的行；规范化后若与同组织既有名冲突，退回 `skill-<id 的 8 位 md5>`。
-- 不加 CHECK 约束（留给应用层契约），避免把历史数据一次锁死。
UPDATE skills s
   SET stable_name = CASE
     WHEN candidate.value <> ''
      AND NOT EXISTS (SELECT 1 FROM skills o WHERE o.org_id = s.org_id AND o.id <> s.id AND o.stable_name = candidate.value)
     THEN candidate.value
     ELSE 'skill-' || left(md5(s.id), 8)
   END
  FROM (
    SELECT id, org_id,
           trim(both '-' from regexp_replace(regexp_replace(lower(stable_name), '[^a-z0-9]+', '-', 'g'), '-{2,}', '-', 'g')) AS value
      FROM skills
     WHERE stable_name !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ) candidate
 WHERE candidate.id = s.id AND candidate.org_id = s.org_id;
