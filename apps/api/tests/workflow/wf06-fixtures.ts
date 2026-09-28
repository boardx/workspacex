// @global-scope-fixture table:workflow_trigger_lookup: 无 org_id 列（webhook/pg-boss 唤醒还没有租户上下文时的
// 唯一查找路径，见迁移文件头注），但每一行都以 FK ON DELETE CASCADE 挂在 workflow_triggers.id 上，而
// workflow_triggers 又 CASCADE 自 organizations——resetOrgs() 删组织行时这张表跟着清空，不需要本文件自己收敛。
/** WF06 测试夹具：登记 workflow_triggers / workflow_trigger_lookup（webhook + schedule 触发器）。 */
import { randomUUID } from "node:crypto";
import { asApp } from "../support/db";

export interface TriggerFixture {
  triggerId: string;
  secret: string;
}

export async function seedWebhookTrigger(args: {
  orgId: string;
  workflowKey: string;
  ownerUserId: string;
  agentId: string;
  version?: number;
}): Promise<TriggerFixture> {
  const triggerId = `wt-${randomUUID()}`;
  const secret = randomUUID();
  await asApp(args.orgId, (c) =>
    c.query(
      `INSERT INTO workflow_triggers (id, org_id, kind, workflow_key, version, owner_user_id, agent_id)
       VALUES ($1, $2, 'webhook', $3, $4, $5, $6)`,
      [triggerId, args.orgId, args.workflowKey, args.version ?? null, args.ownerUserId, args.agentId],
    ),
  );
  await asApp(null, (c) =>
    c.query(`INSERT INTO workflow_trigger_lookup (id, org_id_hint, secret_ref) VALUES ($1, $2, $3)`, [triggerId, args.orgId, secret]),
  );
  return { triggerId, secret };
}

export async function seedScheduleTrigger(args: {
  orgId: string;
  workflowKey: string;
  ownerUserId: string;
  agentId: string;
  version?: number;
  defaultInput?: Record<string, unknown>;
}): Promise<{ triggerId: string }> {
  const triggerId = `wt-${randomUUID()}`;
  await asApp(args.orgId, (c) =>
    c.query(
      `INSERT INTO workflow_triggers (id, org_id, kind, workflow_key, version, owner_user_id, agent_id, default_input)
       VALUES ($1, $2, 'schedule', $3, $4, $5, $6, $7::jsonb)`,
      [triggerId, args.orgId, args.workflowKey, args.version ?? null, args.ownerUserId, args.agentId, JSON.stringify(args.defaultInput ?? {})],
    ),
  );
  await asApp(null, (c) =>
    c.query(`INSERT INTO workflow_trigger_lookup (id, org_id_hint, secret_ref) VALUES ($1, $2, NULL)`, [triggerId, args.orgId]),
  );
  return { triggerId };
}
