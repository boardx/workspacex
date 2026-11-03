/** Persisted editing preconditions only: no extraction/model-quality evidence. */
import { z } from "zod";
import { toBatchPayload } from "../../src/infrastructure/knowledge-graph/pg-ontology-store";
import type { OntologyBatch } from "../../src/domain/knowledge-graph/ontology-batch";
import { BcryptPasswordHasher } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import { addOrgMember, asApp, asOwner, resetOrgs, seedOrg } from "../../tests/support/db";
import { addChatMessage, addChatThread } from "../../tests/support/chat-db";
const nonempty = z.string().min(1);
const Input = z.object({ orgId: nonempty, projectId: nonempty, userId: nonempty, email: nonempty, password: nonempty, threadId: nonempty, sourceGoalId: nonempty, sourceTodoId: nonempty, goalText: nonempty, todoText: nonempty, threadTitle: nonempty }).strict();
export async function seedAboutMeI18n(raw: unknown): Promise<void> {
  const a = Input.parse(raw);
  await resetOrgs(a.orgId);
  await seedOrg({ orgId: a.orgId, projectId: a.projectId });
  await addOrgMember(a.orgId, a.userId, "consultant", null);
  const hash = await new BcryptPasswordHasher().hash(a.password);
  // Credentials are global: reset only this isolated identity, including repeat seed.
  await asOwner(async c => {
    await c.query("DELETE FROM credentials WHERE user_id=$1 OR email=$2", [a.userId,a.email]);
    await c.query("INSERT INTO credentials(user_id,email,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())", [a.userId,a.email,"About me fixture",hash]);
  });
  // seedOrg owns this default. Assert it before source messages instead of recreating it.
  await asApp(a.orgId, async c => {
    const r = await c.query<{ enabled: boolean }>("SELECT enabled FROM kg_org_extraction_settings WHERE org_id=$1", [a.orgId]);
    if (r.rows[0]?.enabled !== false) throw new Error("About me fixture requires extraction disabled by seedOrg");
  });
  await addChatThread({ orgId:a.orgId,id:a.threadId,projectId:null,visibilityScope:"private",createdBy:a.userId,title:a.threadTitle });
  const rows = [{ id:a.sourceGoalId,kind:"goal",text:a.goalText }, { id:a.sourceTodoId,kind:"todo",text:a.todoText }] as const;
  for (const row of rows) await addChatMessage({ orgId:a.orgId,id:`message-${row.id}`,threadId:a.threadId,body:row.text,authorId:a.userId });
  await asApp(a.orgId, async c => {
    await c.query("SELECT set_config('app.current_user_id',$1,true)", [a.userId]);
    const personalIds: Partial<Record<"goal" | "todo",string>> = {};
    for (const row of rows) {
      const batch: OntologyBatch = {
        actionId:`batch-${row.id}`,scope:{kind:"chat_session",id:a.threadId},actor:{kind:"model",id:"controlled-about-me-fixture"},
        actionType:"extract",sourceRef:`message-${row.id}`,pipelineVersion:"about-me-fixture-v1",objects:[],edges:[],
        claims:[{id:row.id,claimKind:row.kind,statement:row.text,status:"proposed",confidence:0.9,evidence:[{messageId:`message-${row.id}`,stance:"supporting",excerpt:row.text}]}],
      };
      await c.query("SELECT kg_apply_batch($1::jsonb)",[JSON.stringify(toBatchPayload(batch))]);
      await c.query("SELECT set_config('app.current_user_id',$1,true)", [a.userId]);
      const promoted = await c.query<{ id: unknown }>("SELECT kg_promote_claim($1::jsonb) AS id",[JSON.stringify({action_id:`promote-${row.id}`,thread_id:a.threadId,claim_id:row.id,mode:"new"})]);
      personalIds[row.kind] = nonempty.parse(promoted.rows[0]?.id);
    }
    if (!personalIds.goal || !personalIds.todo) throw new Error("Expected actual promoted personal IDs");
    await c.query("SELECT kg_set_goal_link($1::jsonb)",[JSON.stringify({action_id:`link-${a.sourceTodoId}`,claim_id:personalIds.todo,goal_claim_id:personalIds.goal})]);
    const count=await c.query<{ count: string }>("SELECT count(*) AS count FROM claims WHERE org_id=$1 AND scope_kind='personal' AND scope_id=$2 AND revoked_at IS NULL AND status<>'superseded'",[a.orgId,a.userId]);
    if(Number(count.rows[0]?.count)!==2) throw new Error("Expected two live personal editing preconditions");
  });
  process.stdout.write(`[about-me-i18n-fixture] org=${a.orgId} actor=consultant personal=2 accepted-by-promotion sources=2 canonical-executor extraction=disabled\n`);
}
