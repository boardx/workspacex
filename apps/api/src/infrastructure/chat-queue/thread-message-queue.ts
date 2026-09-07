import { QueueNotVisibleError, QueueConflictError } from "../../application/chat/thread-message-queue";
export { THREAD_MESSAGE_QUEUE } from "../../application/chat/thread-message-queue";
import { randomUUID } from "node:crypto";
import type { OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import type { QueuedMessage } from "@repo/contracts/thread-message-queue";
import type { DatabasePort } from "../../application/ports/database.port";
import type { DefaultAgentResolver } from "../../application/chat/message-command-ports";
import { QueuedMessageNotReadyError } from "../../application/chat/message-command-ports";
import { acceptHumanMessage, AgentNotPublishedError, MessageThreadNotVisibleError, MessageNoWriteRoleError, MessageThreadArchivedError, MessageIdempotencyConflictError } from "../../application/chat/message-roundtrip";
import { resolveVisibility } from "../../application/chat/resolve-visibility";
import type { AcceptMessagePlanRunCreatorDeps } from "../plan-control/accept-message-plan-run-creator";
import { toOrgId, type OrgId } from "../../domain/org-id";

interface Row { id:string; client_request_id:string; body:string; agent_id:string; actor_id:string; thread_id:string; status:QueuedMessage["status"]; run_id:string|null; created_at:Date; error_code:string|null }
function project(row: Row): QueuedMessage { return { id:row.id, clientRequestId:row.client_request_id, text:row.body, agentId:row.agent_id, status:row.status, runId:row.run_id, createdAt:row.created_at.toISOString(), error:row.error_code }; }
/** Durable next-turn queue. Acceptance remains the existing message/run transaction. */
export class ThreadMessageQueue implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private pumping = false;
  private stopped = false;
  constructor(private readonly deps: AcceptMessagePlanRunCreatorDeps & { db:DatabasePort; defaultAgents:DefaultAgentResolver }) {}
  onModuleInit() { this.timer=setInterval(() => { void this.pump(); },1000); this.timer.unref?.(); void this.pump(); }
  onModuleDestroy() { this.stopped=true; if(this.timer) clearInterval(this.timer); }
  private async authorize(orgId:OrgId,userId:string,threadId:string,write=false) {
    const facts=await this.deps.chat.findThreadFacts(orgId,threadId);
    if(!facts) throw new QueueNotVisibleError();
    const access=await resolveVisibility(this.deps,{orgId,userId,threadId,projectId:facts.projectId});
    if(access.kind!=="allow" || (write && (access.actor.projectRole==="observer" || access.thread.archived))) throw new QueueNotVisibleError();
  }
  async list(orgId:OrgId,userId:string,threadId:string) {
    await this.authorize(orgId,userId,threadId);
    return this.deps.db.withTenant(orgId,async s => ({items:(await s.query<Row>(`SELECT * FROM thread_message_queue WHERE org_id=$1 AND thread_id=$2 AND actor_id=$3 AND (status='pending' OR sequence IN (SELECT sequence FROM thread_message_queue WHERE org_id=$1 AND thread_id=$2 AND actor_id=$3 AND status<>'pending' ORDER BY sequence DESC LIMIT 100)) ORDER BY sequence`,[orgId,threadId,userId])).rows.map(project)}));
  }
  async enqueue(orgId:OrgId,userId:string,threadId:string,input:{clientRequestId:string;text:string;agentId?:string|null}) {
    await this.authorize(orgId,userId,threadId,true);
    const existing=await this.deps.db.withTenant(orgId,s=>s.query<Row>(`SELECT * FROM thread_message_queue WHERE org_id=$1 AND thread_id=$2 AND actor_id=$3 AND client_request_id=$4::uuid`,[orgId,threadId,userId,input.clientRequestId]));
    if(existing.rows[0]) {
      const row=existing.rows[0];
      if(row.body!==input.text || (input.agentId && row.agent_id!==input.agentId)) throw new QueueConflictError();
      return project(row);
    }
    const agentId=input.agentId ?? await this.deps.defaultAgents.resolveDefaultAgentId(orgId);
    if(!agentId || !await this.deps.publishedAgents.resolvePublished(orgId,agentId)) throw new AgentNotPublishedError();
    const item=await this.deps.db.withTenant(orgId,async s => {
      await s.query(`SELECT id FROM chat_threads WHERE org_id=$1 AND id=$2 FOR UPDATE`,[orgId,threadId]);
      const capacity=await s.query(`SELECT id FROM thread_message_queue WHERE org_id=$1 AND thread_id=$2 AND actor_id=$3 AND status='pending' LIMIT 100`,[orgId,threadId,userId]);
      if(capacity.rows.length>=100) {
        const replay=await s.query(`SELECT id FROM thread_message_queue WHERE org_id=$1 AND thread_id=$2 AND actor_id=$3 AND client_request_id=$4::uuid`,[orgId,threadId,userId,input.clientRequestId]);
        if(!replay.rows.length) throw new QueueConflictError();
      }
      await s.query(`INSERT INTO thread_message_queue(org_id,thread_id,actor_id,client_request_id,body,agent_id) VALUES($1,$2,$3,$4::uuid,$5,$6) ON CONFLICT(org_id,thread_id,actor_id,client_request_id) DO NOTHING`,[orgId,threadId,userId,input.clientRequestId,input.text,agentId]);
      const row=(await s.query<Row>(`SELECT * FROM thread_message_queue WHERE org_id=$1 AND thread_id=$2 AND actor_id=$3 AND client_request_id=$4::uuid`,[orgId,threadId,userId,input.clientRequestId])).rows[0]!;
      if(row.body!==input.text || (input.agentId && row.agent_id!==input.agentId)) throw new QueueConflictError();
      return project(row);
    });
    void this.pump(); return item;
  }
  async cancel(orgId:OrgId,userId:string,threadId:string,id:string) {
    await this.authorize(orgId,userId,threadId,true);
    return this.deps.db.withTenant(orgId,async s => {
      const row=(await s.query<Row>(`UPDATE thread_message_queue SET status='cancelled' WHERE org_id=$1 AND thread_id=$2 AND actor_id=$3 AND id=$4::uuid AND status IN ('pending','cancelled') RETURNING *`,[orgId,threadId,userId,id])).rows[0];
      if(!row) throw new QueueConflictError(); return project(row);
    });
  }
  async pump():Promise<void> {
    if(this.pumping || this.stopped) return;
    this.pumping=true;
    try {
      const orgs=await this.deps.db.withoutTenant(s=>s.query<{org_id:string}>(`SELECT org_id FROM kernel_message_queue_orgs()`));
      for(const {org_id} of orgs.rows) {
        if(this.stopped) break;
        const orgId=toOrgId(org_id);
        // Recover an accepted run even if the process died before its kick.
        this.deps.executor.kick(orgId);
        const rows=await this.deps.db.withTenant(orgId,s=>s.query<Row>(`SELECT q.* FROM thread_message_queue q WHERE q.org_id=$1 AND q.status='pending'
          AND NOT EXISTS(SELECT 1 FROM thread_message_queue older WHERE older.org_id=q.org_id AND older.thread_id=q.thread_id AND older.status='pending' AND older.sequence<q.sequence)
          AND NOT EXISTS(SELECT 1 FROM agent_runs r WHERE r.org_id=q.org_id AND r.thread_id=q.thread_id AND r.status NOT IN('succeeded','failed','cancelled'))
          ORDER BY q.sequence LIMIT 20`,[orgId]));
        for(const row of rows.rows) {
          try {
            await acceptHumanMessage(this.deps,{orgId,userId:row.actor_id,threadId:row.thread_id,
              clientMessageId:row.id,queuedMessageId:row.id,text:row.body,agentId:row.agent_id,
              onAccepted:()=>this.deps.executor.kick(orgId)});
          } catch(error) {
            if(error instanceof QueuedMessageNotReadyError) continue;
            if(error instanceof AgentNotPublishedError || error instanceof MessageThreadNotVisibleError || error instanceof MessageNoWriteRoleError || error instanceof MessageThreadArchivedError || error instanceof MessageIdempotencyConflictError) {
              await this.deps.db.withTenant(orgId,s=>s.query(`UPDATE thread_message_queue SET status='failed',error_code='QUEUE_DELIVERY_REJECTED' WHERE org_id=$1 AND id=$2::uuid AND status='pending'`,[orgId,row.id]));
            } else this.deps.logger.error("queued message dispatch retry",{traceId:randomUUID(),orgId,err:"queue_delivery_failed"});
          }
        }
      }
    } catch { this.deps.logger.error("message queue scan retry",{traceId:randomUUID(),err:"queue_scan_failed"}); }
    finally {this.pumping=false;}
  }
}
