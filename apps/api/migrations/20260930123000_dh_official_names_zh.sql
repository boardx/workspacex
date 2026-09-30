/*
 * 官方数字人中文名（ad-hoc，UIUX 复审 2026-09-30：界面不再露英文标识）。
 *
 * 官方角色包 1.4.0 把四个官方角色的 name / role_label 改为中文（stableName → 中文名的唯一声明处 =
 * apps/api/src/domain/agent/official-role-packs.ts ROLE_SEEDS；official-role-pack-import.test.ts 核对
 * 本文件字面量与之一致）。已导入旧版包的组织：只改仍是旧英文原名的官方草稿行（目录读 agents 行的
 * name / role_label），组织改过的名字不动；重复执行无副作用。
 */
CREATE TEMP TABLE dh_official_names_zh (stable_name text PRIMARY KEY, old_name text NOT NULL, new_name text NOT NULL) ON COMMIT DROP;
INSERT INTO dh_official_names_zh (stable_name, old_name, new_name) VALUES
  ('d002-research-knowledge-analyst', 'Research & Knowledge Analyst', '研究与知识分析师'),
  ('d003-product-manager',            'Product Manager',              '产品经理'),
  ('d005-sales-representative',       'Sales Representative',         '销售代表'),
  ('d011-design-thinking-expert',     'Design Thinking Expert',       '设计思维专家');

UPDATE agents a
   SET name = CASE WHEN a.name = b.old_name THEN b.new_name ELSE a.name END,
       role_label = CASE WHEN a.role_label = b.old_name THEN b.new_name ELSE a.role_label END
  FROM dh_official_names_zh b
 WHERE a.stable_name = b.stable_name
   AND a.catalog_source = 'official'
   AND (a.name = b.old_name OR a.role_label = b.old_name);

-- 聊天选人读 capability_listings（导入时从角色包投影：name / duty / role_label 都是 roleLabel），同步改。
UPDATE capability_listings c
   SET name = CASE WHEN c.name = b.old_name THEN b.new_name ELSE c.name END,
       duty = CASE WHEN c.duty = b.old_name THEN b.new_name ELSE c.duty END,
       role_label = CASE WHEN c.role_label = b.old_name THEN b.new_name ELSE c.role_label END
  FROM agents a
  JOIN dh_official_names_zh b ON b.stable_name = a.stable_name
 WHERE c.id = a.id AND c.org_id = a.org_id AND c.kind = 'agent'
   AND a.catalog_source = 'official'
   AND (c.name = b.old_name OR c.duty = b.old_name OR c.role_label = b.old_name);
