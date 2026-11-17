import { AidtStoredContextSnapshot, AidtContextApplicationInput, AidtContextApplicationEvent, aidtContextSelectorJson, aidtContextSnapshotJson, aidtContextCanonicalJson, type AidtContextApplicationInput as EventInput } from "@repo/contracts/aidt-run-context";
import type { OrgId } from "../../domain/org-id";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { AidtRunContextSnapshotStore } from "../../application/aidt-run-context/ports";
import { AidtContextError } from "../../application/aidt-run-context/errors";
import { assertAidtSourceCoordinates, contextHash } from "../../application/aidt-run-context/prepare";
import { guard } from "../../application/security/permission-filter";
type Stored = import("@repo/contracts/aidt-run-context").AidtStoredContextSnapshot;
type Row={org_id:string;run_id:string;project_id:string;thread_id:string;input_message_id:string;requested_by:string;selector_json:unknown;selector_hash:string;snapshot_json:unknown;snapshot_hash:string;prepared_at:Date|string};
const fail=():never=>{throw new AidtContextError("AIDT_CONTEXT_SNAPSHOT_MISMATCH");};
export function validateStoredAidtContext(value:Stored):Stored {
 const v=AidtStoredContextSnapshot.parse(value);
 assertAidtSourceCoordinates(v.snapshot.selector,v.snapshot.sources);
 if(v.projectId!==v.snapshot.selector.projectId||contextHash(aidtContextSelectorJson(v.snapshot.selector))!==v.selectorHash||contextHash(aidtContextSnapshotJson(v.snapshot))!==v.snapshotHash||contextHash(v.snapshot.modelReferenceBlock)!==v.snapshot.modelReferenceBlockHash)fail();
 return v;
}
/** No work at construction. Caller owns the transaction; protected student text remains Guarded. */
export class PgAidtRunContextStore implements AidtRunContextSnapshotStore {
 constructor(private readonly db:DatabasePort){}
 async readScopeIn(session:TenantSession,orgId:OrgId,runId:string){
  const r=await session.query<{project_id:string;thread_id:string;requested_by:string}>(`SELECT project_id,thread_id,requested_by FROM aidt_run_context_snapshots WHERE org_id=$1 AND run_id=$2`,[orgId,runId]);
  const row=r.rows[0];return row?{projectId:row.project_id,threadId:row.thread_id,requestedBy:row.requested_by}:null;
 }
 async readIn(session:TenantSession,orgId:OrgId,runId:string){
  const r=await session.query<Row>(`SELECT org_id,run_id,project_id,thread_id,input_message_id,requested_by,selector_json,selector_hash,snapshot_json,snapshot_hash,prepared_at FROM aidt_run_context_snapshots WHERE org_id=$1 AND run_id=$2`,[orgId,runId]);
  const row=r.rows[0];if(!row)return null;
  const v=validateStoredAidtContext({orgId:row.org_id,runId:row.run_id,projectId:row.project_id,threadId:row.thread_id,inputMessageId:row.input_message_id,requestedBy:row.requested_by,selectorHash:row.selector_hash,snapshotHash:row.snapshot_hash,snapshot:row.snapshot_json as Stored["snapshot"],preparedAt:new Date(row.prepared_at).toISOString()});
  if(row.org_id!==orgId||row.run_id!==runId||contextHash(aidtContextSelectorJson(row.selector_json as Stored["snapshot"]["selector"]))!==v.selectorHash)fail();
  return guard({kind:"project",id:v.projectId},v);
 }
 async saveIn(session:TenantSession,raw:Stored){const v=validateStoredAidtContext(raw);
  await session.query(`INSERT INTO aidt_run_context_snapshots(org_id,run_id,project_id,thread_id,input_message_id,requested_by,selector_version,selector_json,selector_hash,snapshot_version,snapshot_json,snapshot_hash,prepared_at) VALUES($1,$2,$3,$4,$5,$6,1,$7::jsonb,$8,1,$9::jsonb,$10,$11::timestamptz)`,[v.orgId,v.runId,v.projectId,v.threadId,v.inputMessageId,v.requestedBy,aidtContextSelectorJson(v.snapshot.selector),v.selectorHash,aidtContextSnapshotJson(v.snapshot),v.snapshotHash,v.preparedAt]);
 }
 async eventsIn(session:TenantSession,orgId:OrgId,runId:string){
  const result=await session.query<{seq:number|string;occurred_at:Date|string;event:unknown}>(`SELECT seq,occurred_at,event FROM aidt_run_context_applications WHERE org_id=$1 AND run_id=$2 ORDER BY seq`,[orgId,runId]);
  return result.rows.map(row=>{const seq=Number(row.seq);if(!Number.isSafeInteger(seq)||seq<=0)fail();return AidtContextApplicationEvent.parse({runId,seq,occurredAt:new Date(row.occurred_at).toISOString(),event:row.event});});
 }
 async appendIn(session:TenantSession,orgId:OrgId,runId:string,input:EventInput){
  const run=await session.query(`SELECT id FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE`,[orgId,runId]);if(!run.rows[0])throw new AidtContextError("AIDT_CONTEXT_NOT_AVAILABLE");
  const metadata=await session.query<{snapshot_hash:string;block_hash:string}>(`SELECT snapshot_hash,snapshot_json->>'modelReferenceBlockHash' AS block_hash FROM aidt_run_context_snapshots WHERE org_id=$1 AND run_id=$2`,[orgId,runId]);
  const stored=metadata.rows[0];let event=AidtContextApplicationInput.parse(input);if(!stored)throw new AidtContextError("AIDT_CONTEXT_SNAPSHOT_MISMATCH");if(stored.snapshot_hash!==event.snapshotHash)fail();
  if((event.kind==="assembled"||event.kind==="message-dispatch-observed")&&event.assembledContextHash!==stored.block_hash)fail();
  const prior=await this.eventsIn(session,orgId,runId);
  if(event.kind==="checkpoint-resume-observed"){
    const first=prior.find(row=>row.event.kind==="message-dispatch-observed"&&row.event.snapshotHash===event.snapshotHash&&row.event.assembledContextHash===stored.block_hash);
    event={...event,inheritedMessageDispatchAttemptId:first?.event.attemptId??null,assembledContextHash:first?stored.block_hash:null};
  }
  const seq=(prior.at(-1)?.seq??0)+1;
  await session.query(`INSERT INTO aidt_run_context_applications(org_id,run_id,seq,attempt_id,kind,snapshot_hash,event,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,clock_timestamp())`,[orgId,runId,seq,event.attemptId,event.kind,event.snapshotHash,aidtContextCanonicalJson(event)]);
 }
 append(orgId:OrgId,runId:string,event:EventInput){return this.db.withTenant(orgId,s=>this.appendIn(s,orgId,runId,event));}
}
