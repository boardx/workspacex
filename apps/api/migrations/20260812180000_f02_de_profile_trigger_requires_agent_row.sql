-- #1088 —— F02 数字专家画像触发器过严：`capability_listings` 里 kind='agent' 的行插入/改 kind
-- 就无条件往 `digital_expert_profiles` 塞一行，但该表对 `agent_id` 有 FK
-- `(agent_id, org_id) REFERENCES agents(id, org_id)`。生产路径下「capability_listings 的 agent
-- 行必有对应 agents 行」通常成立，但全仓共用的测试 fixture `addCapability`（tests/support/db.ts，
-- 15+ 调用点）只插 capability_listings、从不建 agents 行——触发器无条件插入直接炸 FK，波及
-- 10 个文件 58 个与「数字专家」毫不相干的测试（tests/auth/deny-reason-org-layer.test.ts、
-- tests/auth/team-visibility-filter.test.ts、tests/chat/agent-roster-capability-convergence.test.ts
-- 等）。已在全新隔离库上控制实验反证：同样的迁移链、不含任何 F154 改动，同样炸这个 FK。
--
-- 修法：触发器函数改成「先确认 agents 表确有同 id/org 行，没有就静默跳过」——不改
-- `digital_expert_profiles` 的 FK（生产路径下「有真实 agent 才建画像」仍是正确不变式），只让
-- 触发器不再对着还没建 agents 行的 capability_listings 行强行插入。这条修在触发器层，而非改
-- 15+ 处调用点的 fixture（成本更低、且不掩盖「有 agents 行才有画像」这条不变式本身）。
CREATE OR REPLACE FUNCTION ensure_digital_expert_profile()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'agent'
     AND EXISTS (SELECT 1 FROM agents WHERE id = NEW.id AND org_id = NEW.org_id) THEN
    INSERT INTO digital_expert_profiles (org_id, agent_id, domains)
    VALUES (NEW.org_id, NEW.id, ARRAY['未分类']::text[])
    ON CONFLICT (org_id, agent_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
