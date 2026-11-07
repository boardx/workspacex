/** Read-only UI fixture: persisted summaries, not evidence of workflow execution/model quality. */
import { BcryptPasswordHasher } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import { addOrgMember, addProjectMember, asApp, asOwner, resetOrgs, seedOrg } from "../../tests/support/db";

export async function seedWorkflowRunsI18n(args: {
  orgId: string; projectId: string; userId: string; email: string; password: string;
  instanceId: string; workflowKey: string; goal: string;
}): Promise<void> {
  await resetOrgs(args.orgId);
  const fixture = await seedOrg({ orgId: args.orgId, projectId: args.projectId, teamNames: ["workflow-list"], groupNames: ["gate"] });
  await addOrgMember(args.orgId, args.userId, "consultant", fixture.teams["workflow-list"] ?? null);
  await addProjectMember(args.orgId, args.projectId, args.userId, "facilitator", null, true);
  const peer = `${args.userId}-peer`;
  await addOrgMember(args.orgId, peer, "consultant", null);
  const hash = await new BcryptPasswordHasher().hash(args.password);
  // Global credentials belong only to this isolated fixture identity; all product reads use app/RLS.
  await asOwner(async (client) => {
    await client.query("DELETE FROM credentials WHERE user_id=$1 OR email=$2", [args.userId, args.email]);
    await client.query("INSERT INTO credentials(user_id,email,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())", [args.userId, args.email, "原文 {member}", hash]);
  });
  await asApp(args.orgId, async (client) => {
      await client.query("INSERT INTO workflow_definitions(org_id,key) VALUES($1,$2)", [args.orgId, args.workflowKey]);
      await client.query(`INSERT INTO workflow_definition_versions(org_id,key,version,graph_ref,title,status,stages,input_schema,published_at)
        VALUES($1,$2,1,$3,'Read-only fixture','published','[]'::jsonb,'{}'::jsonb,now())`, [args.orgId, args.workflowKey, `${args.workflowKey}:1`]);
      const rows = [
        { id: args.instanceId, owner: args.userId, status: "succeeded", goal: args.goal },
        { id: `${args.instanceId}-failed`, owner: args.userId, status: "failed", goal: args.goal },
        { id: `${args.instanceId}-peer`, owner: peer, status: "succeeded", goal: "Private peer goal" },
      ];
      for (const row of rows) {
        await client.query(`INSERT INTO workflow_instances(id,org_id,workflow_key,definition_version,graph_ref,pinned_skills,agent_id,agent_version_id,initiator_user_id,trigger_kind,status,state_version)
          VALUES($1,$2,$3,1,$4,'[]'::jsonb,'read-only-fixture-agent','read-only-fixture-version',$5,'manual','running',1)`, [row.id,args.orgId,args.workflowKey,`${args.workflowKey}:1`,row.owner]);
        await client.query(`INSERT INTO workflow_events(instance_id,org_id,seq,type,state_version,data) VALUES($1,$2,1,'instance_started',1,$3::jsonb)`, [row.id,args.orgId,JSON.stringify({input:{goal:row.goal}})]);
        await client.query("UPDATE workflow_instances SET status=$1,state_version=2,updated_at=now() WHERE id=$2 AND org_id=$3", [row.status,row.id,args.orgId]);
        await client.query(`INSERT INTO workflow_events(instance_id,org_id,seq,type,state_version,data) VALUES($1,$2,2,'status_changed',2,$3::jsonb)`, [row.id,args.orgId,JSON.stringify({status:row.status})]);
      }
      const count = await client.query<{ count: string }>("SELECT count(*) AS count FROM workflow_instances WHERE org_id=$1", [args.orgId]);
      if (Number(count.rows[0]?.count) !== 3) throw new Error("Expected three isolated workflow precondition rows");
  });
  process.stdout.write(`[workflow-runs-i18n-fixture] org=${args.orgId} persisted=3 actorOwned=2 execution=not-tested\n`);
}
