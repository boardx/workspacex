/*
 * 数字人肖像头像（ad-hoc，60 格「WorkspaceX Digital Humans — 60 Role Avatars」）。
 *
 * ① 放宽 agent_role_fields_ok() 的头像 key 集：契约 `AvatarKey`
 *    (packages/contracts/src/interview-expert-avatar.ts) 新增 60 个 `dh-NN-<slug>` 肖像 key。
 *    与 20260928230000_ag01 同一约定——SQL 无法 import TS，下面的正则是**被机械核对的副本**：
 *    apps/api/tests/agent/version-snapshot-frozen-fields.test.ts 对契约 key 全集逐一比对 CHECK 判定。
 *    其余分支逐字沿用 ag01 原函数（旧迁移不改）。
 *
 * ② 回填已导入官方角色包 1.0.0 的组织：四个官方角色 avatar 仍为 NULL 的，写成 1.1.0 包里的
 *    肖像（stableName → key 的唯一声明处 = apps/api/src/domain/agent/official-role-packs.ts
 *    ROLE_SEEDS；official-role-pack-import.test.ts 核对本文件字面量与之一致）。草稿行
 *    agents 与其已发布版本 agent_versions 同改——目录读的是发布快照。发布快照有不可变触发器，
 *    这里只对这一条 UPDATE 临时关掉它（与 20260926120000 清理迁移同一做法），且只动 avatar
 *    一列、只动 avatar IS NULL 的行：已被管理员手动设过头像的不覆盖；重复执行无副作用。
 */
CREATE OR REPLACE FUNCTION agent_role_fields_ok(
  p_avatar jsonb, p_workflow_allowlist text[], p_delegation jsonb, p_escalation jsonb, p_kpi jsonb
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_avatar IS NOT NULL THEN
    IF jsonb_typeof(p_avatar) <> 'object'
       OR p_avatar->>'kind' IS DISTINCT FROM 'illustration'
       OR jsonb_typeof(p_avatar->'key') IS DISTINCT FROM 'string'
       OR p_avatar->>'key' !~ '^(person-([1-9]|1[0-9]|2[0-4])|robot|dh-(01-executive-strategy-partner|02-research-knowledge-analyst|03-product-manager|04-marketing-growth-manager|05-sales-representative|06-customer-success-specialist|07-project-operations-manager|08-finance-analyst|09-legal-compliance-analyst|10-hr-talent-specialist|11-design-thinking-expert|12-lean-kaizen-expert|13-six-sigma-quality-expert|14-business-process-reengineering-expert|15-agile-product-operating-model-coach|16-organizational-change-expert|17-decision-science-expert|18-ai-transformation-architect|19-manufacturing-operations-expert|20-supply-chain-procurement-expert|21-retail-e-commerce-expert|22-banking-financial-services-expert|23-insurance-claims-expert|24-healthcare-operations-expert|25-life-sciences-pharma-expert|26-education-learning-designer|27-real-estate-construction-expert|28-energy-utilities-expert|29-logistics-transportation-expert|30-government-public-service-expert|31-fp-a-analyst|32-accounting-specialist|33-treasury-analyst|34-procurement-specialist|35-supply-chain-planner|36-quality-engineer|37-manufacturing-planner|38-software-engineer|39-solution-architect|40-data-analyst|41-data-engineer|42-cybersecurity-analyst|43-ux-researcher|44-content-strategist|45-revenue-operations-analyst|46-customer-support-operations-specialist|47-learning-experience-designer|48-compliance-officer|49-business-analyst|50-process-analyst|51-credit-analyst|52-investment-analyst|53-risk-analyst|54-clinical-research-analyst|55-regulatory-affairs-specialist|56-medical-affairs-analyst|57-construction-project-analyst|58-real-estate-analyst|59-energy-analyst|60-sustainability-esg-analyst))$'
       OR jsonb_typeof(p_avatar->'alt') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
  END IF;
  IF p_workflow_allowlist IS NULL
     OR cardinality(p_workflow_allowlist) > 64
     OR array_position(p_workflow_allowlist, NULL) IS NOT NULL
     OR array_to_string(p_workflow_allowlist, ',') !~ '^(W[0-9]{3}(,W[0-9]{3})*)?$' THEN
    RETURN false;
  END IF;

  IF p_delegation IS NULL OR jsonb_typeof(p_delegation) <> 'object'
     OR jsonb_typeof(p_delegation->'allowedTargets') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_delegation->'maxDepth') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_delegation->'requireApproval') IS DISTINCT FROM 'boolean' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_delegation->'allowedTargets') > 32
     OR jsonb_path_exists(p_delegation,
          '$.allowedTargets[*] ? (@.type() != "string" || !(@ like_regex "^D[0-9]{3}$"))')
     OR (p_delegation->>'maxDepth')::numeric NOT IN (0, 1, 2) THEN
    RETURN false;
  END IF;

  IF p_escalation IS NULL OR jsonb_typeof(p_escalation) <> 'object'
     OR jsonb_typeof(p_escalation->'rules') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_escalation->'rules') > 64
     OR jsonb_path_exists(p_escalation,
          '$.rules[*] ? (!(@.target == "requester" || @.target == "project_owner" || @.target == "org_admin"))') THEN
    RETURN false;
  END IF;

  IF p_kpi IS NULL OR jsonb_typeof(p_kpi) <> 'array' OR jsonb_array_length(p_kpi) > 16 THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE TEMP TABLE dh_official_avatar_backfill (stable_name text PRIMARY KEY, avatar jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO dh_official_avatar_backfill (stable_name, avatar) VALUES
  ('d002-research-knowledge-analyst', '{"kind":"illustration","key":"dh-02-research-knowledge-analyst","alt":"Research & Knowledge Analyst"}'),
  ('d003-product-manager',            '{"kind":"illustration","key":"dh-03-product-manager","alt":"Product Manager"}'),
  ('d005-sales-representative',       '{"kind":"illustration","key":"dh-05-sales-representative","alt":"Sales Representative"}'),
  ('d011-design-thinking-expert',     '{"kind":"illustration","key":"dh-11-design-thinking-expert","alt":"Design Thinking Expert"}');

ALTER TABLE agent_versions DISABLE TRIGGER agent_versions_immutable_trg;
UPDATE agent_versions v
   SET avatar = b.avatar
  FROM agents a
  JOIN dh_official_avatar_backfill b ON b.stable_name = a.stable_name
 WHERE v.agent_id = a.id AND v.org_id = a.org_id
   AND a.catalog_source = 'official' AND v.catalog_source = 'official'
   AND v.avatar IS NULL;
ALTER TABLE agent_versions ENABLE TRIGGER agent_versions_immutable_trg;

UPDATE agents a
   SET avatar = b.avatar
  FROM dh_official_avatar_backfill b
 WHERE a.stable_name = b.stable_name AND a.catalog_source = 'official' AND a.avatar IS NULL;
