import type { DatabasePort } from "../../application/ports/database.port";
import type { AsrUsageEvent, AsrUsageMeter, RealtimeAsrTicket, RealtimeAsrTicketStore } from "../../application/recording/personal-realtime-asr";
import type { OrgId } from "../../domain/org-id";

export class PgRealtimeAsrTicketStore implements RealtimeAsrTicketStore {
  constructor(private readonly db: DatabasePort) {}
  async issue(input: RealtimeAsrTicket & { ticket: string }): Promise<RealtimeAsrTicket> {
    await this.db.withTenant(input.orgId, (s) => s.query(`INSERT INTO realtime_asr_tickets
      (ticket_hash,org_id,owner_user_id,transcription_id,capture_id,expires_at) VALUES($1,$2,$3,$4,$5,to_timestamp($6/1000.0))`,
      [input.ticketHash,input.orgId,input.ownerUserId,input.transcriptionId,input.captureId,input.expiresAtMs]));
    return input;
  }
  async consume(input: { ticketHash: string; orgId: OrgId; transcriptionId: string; captureId: string }) {
    return this.db.withTenant(input.orgId, async (s) => {
      const result = await s.query<{ owner_user_id:string; expires_at:string; used_at:string|null }>(`SELECT owner_user_id,expires_at,used_at
        FROM realtime_asr_tickets WHERE ticket_hash=$1 AND transcription_id=$2 AND capture_id=$3 FOR UPDATE`,
        [input.ticketHash,input.transcriptionId,input.captureId]);
      const row=result.rows[0];
      if(!row) return {ok:false as const,reason:"TICKET_INVALID" as const};
      if(row.used_at) return {ok:false as const,reason:"TICKET_USED" as const};
      if(Date.parse(row.expires_at)<Date.now()) return {ok:false as const,reason:"TICKET_EXPIRED" as const};
      await s.query(`UPDATE realtime_asr_tickets SET used_at=now() WHERE ticket_hash=$1`,[input.ticketHash]);
      return {ok:true as const,ticketHash:input.ticketHash,orgId:input.orgId,ownerUserId:row.owner_user_id,
        transcriptionId:input.transcriptionId,captureId:input.captureId,expiresAtMs:Date.parse(row.expires_at)};
    });
  }
}
export class PgAsrUsageMeter implements AsrUsageMeter {
  constructor(private readonly db: DatabasePort) {}
  async record(e: AsrUsageEvent):Promise<boolean>{ return this.db.withTenant(e.orgId,async s=>{
    const r=await s.query(`INSERT INTO realtime_asr_usage_events(provider_task_id,org_id,owner_user_id,capture_id,model,duration_seconds)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider_task_id) DO NOTHING RETURNING provider_task_id`,
      [e.providerTaskId,e.orgId,e.ownerUserId,e.captureId,e.model,e.durationSeconds]); return r.rows.length===1;
  });}
}
