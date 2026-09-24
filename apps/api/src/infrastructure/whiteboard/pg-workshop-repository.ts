import { PgWhiteboardCollaborationStore } from './pg-collaboration-store';
import { createHash, randomUUID } from 'node:crypto';
import { WorkerWhiteboardUpdateValidator } from './update-validator';
import * as C from '@repo/contracts/whiteboard-workshop';
import type { Principal } from '../../domain/principal';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import { WorkshopConflict, type WhiteboardWorkshop } from '../../application/whiteboard/workshop-ports';

type Role = 'owner' | 'editor' | 'viewer';
type VoteRow = { id: string; title: string; quota: number; duration_seconds: number; object_ids: string[]; deadline: Date; closed: boolean };
type CommentRow = { id: string; author_id: string; object_id: string | null; text: string; created_at: Date };
const comment = (r: CommentRow): C.Comment => C.Comment.parse({ id: r.id, authorId: r.author_id, objectId: r.object_id, text: r.text, createdAt: new Date(r.created_at).toISOString() });

/** Workshops remain separate from shared Y.Doc and public export. No draft list exists. */
export class PgWorkshopRepository implements WhiteboardWorkshop {
  constructor(private readonly db: DatabasePort, private readonly validator = new WorkerWhiteboardUpdateValidator(), private readonly collaboration = new PgWhiteboardCollaborationStore(db)) {}
  private async requireObjects(s: TenantSession, p: Principal, boardId: string, objectIds: string[]): Promise<void> {
    if (!objectIds.length) return;
    const result = await s.query<{ snapshot: Buffer }>('SELECT snapshot FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2', [p.orgId, boardId]);
    const ids = result.rows[0] ? new Set(await this.validator.objectIds(result.rows[0].snapshot)) : new Set<string>();
    if (objectIds.some(id => !ids.has(id))) throw new WorkshopConflict('OBJECT_NOT_FOUND');
  }
  private async access(s: TenantSession, p: Principal, boardId: string, write = false): Promise<Role | null> {
    // Lock first, then evaluate ACL in a fresh statement snapshot after waiting.
    const locked = await s.query<{ owner_id: string; archived: boolean }>('SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE', [p.orgId, boardId]);
    const board = locked.rows[0];
    if (!board || (write && board.archived)) return null;
    const member = await s.query<{ role: Role }>(`SELECT CASE WHEN $3=$4 THEN 'owner' ELSE m.role END AS role
      FROM org_memberships o LEFT JOIN whiteboard_members m ON m.org_id=o.org_id AND m.user_id=o.user_id AND m.board_id=$2
      WHERE o.org_id=$1 AND o.user_id=$3 AND ($3=$4 OR m.user_id IS NOT NULL)`, [p.orgId,boardId,p.userId,board.owner_id]);
    return member.rows[0]?.role ?? null;
  }
  comments(p: Principal, boardId: string): Promise<C.Comment[] | null> {
    return this.db.withTenant(p.orgId, async s => {
      if (!await this.access(s,p,boardId)) return null;
      const r = await s.query<CommentRow>('SELECT * FROM whiteboard_comments WHERE org_id=$1 AND board_id=$2 ORDER BY created_at,id LIMIT 1000',[p.orgId,boardId]);
      return r.rows.map(comment);
    });
  }
  addComment(p: Principal, boardId: string, input: C.CreateComment): Promise<C.Comment | null> {
    input = C.CreateComment.parse(input);
    return this.db.withTenant(p.orgId, async s => {
      const role = await this.access(s,p,boardId,true); if (!role || role==='viewer') return null;
      const old = await s.query<CommentRow>('SELECT * FROM whiteboard_comments WHERE org_id=$1 AND board_id=$2 AND author_id=$3 AND request_id=$4',[p.orgId,boardId,p.userId,input.requestId]);
      if (old.rows[0]) {
        if (old.rows[0].text !== input.text || old.rows[0].object_id !== input.objectId) throw new WorkshopConflict('REQUEST_ID_REUSED');
        return comment(old.rows[0]);
      }
      await this.requireObjects(s,p,boardId,input.objectId === null ? [] : [input.objectId]);
      const count = await s.query<{ count: string }>('SELECT count(*) FROM whiteboard_comments WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId]);
      if (Number(count.rows[0]?.count)>=1000) throw new WorkshopConflict('COMMENT_LIMIT');
      const r = await s.query<CommentRow>(`INSERT INTO whiteboard_comments(org_id,board_id,id,author_id,request_id,object_id,text)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[p.orgId,boardId,randomUUID(),p.userId,input.requestId,input.objectId,input.text]);
      return comment(r.rows[0]!);
    });
  }
  deleteComment(p: Principal, boardId: string, id: string): Promise<boolean> {
    return this.db.withTenant(p.orgId, async s => {
      const role = await this.access(s,p,boardId,true); if (!role) return false;
      const r = await s.query('DELETE FROM whiteboard_comments WHERE org_id=$1 AND board_id=$2 AND id=$3 AND (author_id=$4 OR $5) RETURNING id',[p.orgId,boardId,id,p.userId,role==='owner']);
      return r.rows.length>0;
    });
  }
  draft(p: Principal, boardId: string): Promise<C.PrivateDraft | null> {
    return this.db.withTenant(p.orgId, async s => {
      if (!await this.access(s,p,boardId)) return null;
      const r = await s.query<{ text: string; revision: string }>('SELECT text,revision FROM whiteboard_private_drafts WHERE org_id=$1 AND board_id=$2 AND user_id=$3',[p.orgId,boardId,p.userId]);
      return { text: r.rows[0]?.text ?? '', revision: r.rows[0]?.revision ?? null };
    });
  }
  saveDraft(p: Principal, boardId: string, input: C.SavePrivateDraft): Promise<C.PrivateDraft | null> {
    input = C.SavePrivateDraft.parse(input);
    return this.db.withTenant(p.orgId, async s => {
      if (!await this.access(s,p,boardId,true)) return null;
      const revision=randomUUID();
      await s.query(`INSERT INTO whiteboard_private_drafts(org_id,board_id,user_id,text,revision) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(org_id,board_id,user_id) DO UPDATE SET text=EXCLUDED.text,revision=EXCLUDED.revision`,[p.orgId,boardId,p.userId,input.text,revision]);
      return {...input,revision};
    });
  }
  publishDraft(p:Principal,boardId:string,input:C.PublishDraft):Promise<C.PublishedDraft|null>{
    input=C.PublishDraft.parse(input);
    const hash=createHash('sha256').update(JSON.stringify([input.expectedRevision,input.geometry.x,input.geometry.y,input.geometry.width,input.geometry.height,input.geometry.rotation])).digest('hex');
    return this.db.withTenant(p.orgId,async s=>{
      const role=await this.access(s,p,boardId,true);if(!role||role==='viewer')return null;
      const previous=await s.query<{request_hash:string;object_id:string;epoch:number;seq:string}>('SELECT request_hash,object_id,epoch,seq FROM whiteboard_draft_publications WHERE org_id=$1 AND board_id=$2 AND user_id=$3 AND request_id=$4',[p.orgId,boardId,p.userId,input.requestId]);
      const replay=previous.rows[0];
      if(replay){if(replay.request_hash!==hash)throw new WorkshopConflict('REQUEST_ID_REUSED');return {objectId:replay.object_id,epoch:replay.epoch,committedSeq:Number(replay.seq),replayed:true};}
      const drafts=await s.query<{text:string;revision:string}>('SELECT text,revision FROM whiteboard_private_drafts WHERE org_id=$1 AND board_id=$2 AND user_id=$3',[p.orgId,boardId,p.userId]);
      const draft=drafts.rows[0];if(!draft||draft.revision!==input.expectedRevision)throw new WorkshopConflict('DRAFT_REVISION_CHANGED');
      if(!draft.text.trim())throw new WorkshopConflict('DRAFT_EMPTY');
      const document=await s.query<{epoch:number}>('SELECT epoch FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId]);
      const objectId=`draft_${input.requestId.replaceAll('-','')}`;
      // The collaborator does not open/commit a nested transaction or broadcast.
      const pending=await this.collaboration.writeCommandsInTransaction(s,p,boardId,{epoch:document.rows[0]?.epoch??1,requestId:input.requestId,commands:[{type:'create',object:{id:objectId,schemaVersion:1,kind:'sticky',geometry:input.geometry,text:draft.text,style:{},parentId:null,orderKey:''}}]});
      const removed=await s.query('DELETE FROM whiteboard_private_drafts WHERE org_id=$1 AND board_id=$2 AND user_id=$3 AND revision=$4 RETURNING user_id',[p.orgId,boardId,p.userId,input.expectedRevision]);
      if(removed.rows.length!==1)throw new WorkshopConflict('DRAFT_REVISION_CHANGED');
      await s.query('INSERT INTO whiteboard_draft_publications(org_id,board_id,user_id,request_id,request_hash,object_id,epoch,seq) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.orgId,boardId,p.userId,input.requestId,hash,objectId,pending.epoch,pending.seq]);
      // withTenant must COMMIT successfully before this promise resolves to HTTP.
      return {objectId,epoch:pending.epoch,committedSeq:pending.seq,replayed:false};
    });
  }
  private async voteView(s: TenantSession, p: Principal, boardId: string, row: VoteRow): Promise<C.Vote> {
    const clock = await s.query<{ expired: boolean }>('SELECT $1::timestamptz<=clock_timestamp() AS expired',[row.deadline]);
    const closed=row.closed||clock.rows[0]!.expired;
    const own = await s.query<{ used: string }>('SELECT COALESCE(sum(count),0) AS used FROM whiteboard_ballots WHERE org_id=$1 AND board_id=$2 AND vote_id=$3 AND user_id=$4',[p.orgId,boardId,row.id,p.userId]);
    const results=closed
      ? (await s.query<{ object_id: string; count: string }>('SELECT object_id,sum(count) AS count FROM whiteboard_ballots WHERE org_id=$1 AND board_id=$2 AND vote_id=$3 GROUP BY object_id ORDER BY object_id',[p.orgId,boardId,row.id])).rows.map(r=>({objectId:r.object_id,count:Number(r.count)}))
      : null;
    return C.Vote.parse({ id:row.id,title:row.title,quota:row.quota,deadline:new Date(row.deadline).toISOString(),closed,
      objectIds:row.object_ids, used:Number(own.rows[0]?.used??0),results });
  }
  votes(p: Principal, boardId: string): Promise<C.Vote[] | null> {
    return this.db.withTenant(p.orgId, async s => {
      if (!await this.access(s,p,boardId)) return null;
      const r = await s.query<VoteRow>('SELECT * FROM whiteboard_votes WHERE org_id=$1 AND board_id=$2 ORDER BY deadline DESC,id LIMIT 100',[p.orgId,boardId]);
      const result: C.Vote[]=[]; for (const row of r.rows) result.push(await this.voteView(s,p,boardId,row)); return result;
    });
  }
  createVote(p: Principal, boardId: string, input: C.CreateVote): Promise<C.Vote | null> {
    input=C.CreateVote.parse(input);
    return this.db.withTenant(p.orgId, async s => {
      if (await this.access(s,p,boardId,true)!=='owner') return null;
      const previous=await s.query<VoteRow>('SELECT * FROM whiteboard_votes WHERE org_id=$1 AND board_id=$2 AND id=$3',[p.orgId,boardId,input.requestId]);
      if (previous.rows[0]) {
        if (previous.rows[0].duration_seconds!==input.durationSeconds || previous.rows[0].title!==input.title || previous.rows[0].quota!==input.quota || JSON.stringify(previous.rows[0].object_ids)!==JSON.stringify(input.objectIds)) throw new WorkshopConflict('REQUEST_ID_REUSED');
        return this.voteView(s,p,boardId,previous.rows[0]);
      }
      const count=await s.query<{count:string}>('SELECT count(*) FROM whiteboard_votes WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId]);
      if(Number(count.rows[0]?.count)>=100) throw new WorkshopConflict('VOTE_SESSION_LIMIT');
      await this.requireObjects(s,p,boardId,input.objectIds);
      const r=await s.query<VoteRow>(`INSERT INTO whiteboard_votes(org_id,board_id,id,title,quota,object_ids,deadline,duration_seconds)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,clock_timestamp()+$7*interval '1 second',$7) RETURNING *`,[p.orgId,boardId,input.requestId,input.title,input.quota,JSON.stringify(input.objectIds),input.durationSeconds]);
      return this.voteView(s,p,boardId,r.rows[0]!);
    });
  }
  castVote(p: Principal, boardId: string, voteId: string, input: C.CastVote): Promise<C.Vote | null> {
    input=C.CastVote.parse(input);
    return this.db.withTenant(p.orgId, async s => {
      if(!await this.access(s,p,boardId,true)) return null;
      // Serialize quota and deadline decisions for one vote. The final conditional INSERT
      // still checks the database clock because the deadline can pass while this transaction runs.
      const r=await s.query<VoteRow>('SELECT * FROM whiteboard_votes WHERE org_id=$1 AND board_id=$2 AND id=$3 FOR UPDATE',[p.orgId,boardId,voteId]);
      const row=r.rows[0]; if(!row)return null;
      const previous=await s.query<{object_id:string;count:number}>('SELECT object_id,count FROM whiteboard_ballots WHERE org_id=$1 AND board_id=$2 AND vote_id=$3 AND user_id=$4 AND request_id=$5',[p.orgId,boardId,voteId,p.userId,input.requestId]);
      if(previous.rows[0]) {
        if(previous.rows[0].object_id!==input.objectId||previous.rows[0].count!==input.count)throw new WorkshopConflict('REQUEST_ID_REUSED');
        return this.voteView(s,p,boardId,row);
      }
      const current=await this.voteView(s,p,boardId,row);
      if(current.closed)throw new WorkshopConflict('VOTE_CLOSED');
      if(!row.object_ids.includes(input.objectId))throw new WorkshopConflict('VOTE_TARGET_INVALID');
      await this.requireObjects(s,p,boardId,[input.objectId]);
      if(current.used+input.count>row.quota)throw new WorkshopConflict('VOTE_QUOTA_EXCEEDED');
      const inserted=await s.query<{object_id:string}>(`INSERT INTO whiteboard_ballots(org_id,board_id,vote_id,user_id,request_id,object_id,count)
        SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS (
          SELECT 1 FROM whiteboard_votes WHERE org_id=$1 AND board_id=$2 AND id=$3 AND closed=false AND deadline>clock_timestamp()
        ) RETURNING object_id`,[p.orgId,boardId,voteId,p.userId,input.requestId,input.objectId,input.count]);
      if(inserted.rows.length!==1)throw new WorkshopConflict('VOTE_CLOSED');
      return this.voteView(s,p,boardId,row);
    });
  }
  closeVote(p: Principal, boardId: string, voteId: string): Promise<C.Vote | null> {
    return this.db.withTenant(p.orgId,async s=>{
      if(await this.access(s,p,boardId,true)!=='owner')return null;
      const r=await s.query<VoteRow>('UPDATE whiteboard_votes SET closed=true WHERE org_id=$1 AND board_id=$2 AND id=$3 RETURNING *',[p.orgId,boardId,voteId]);
      return r.rows[0]?this.voteView(s,p,boardId,r.rows[0]):null;
    });
  }
  private async readTimer(s:TenantSession,p:Principal,boardId:string):Promise<C.Timer>{
    const r=await s.query<{deadline:Date|null;running:boolean}>('SELECT deadline,COALESCE(deadline>clock_timestamp(),false) AS running FROM whiteboard_timers WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId]);
    return { deadline:r.rows[0]?.deadline?new Date(r.rows[0].deadline).toISOString():null,running:r.rows[0]?.running??false };
  }
  timer(p:Principal,boardId:string):Promise<C.Timer|null>{return this.db.withTenant(p.orgId,async s=>await this.access(s,p,boardId)?this.readTimer(s,p,boardId):null);}
  startTimer(p:Principal,boardId:string,input:C.StartTimer):Promise<C.Timer|null>{
    input=C.StartTimer.parse(input);
    return this.db.withTenant(p.orgId,async s=>{
      if(await this.access(s,p,boardId,true)!=='owner')return null;
      await s.query(`INSERT INTO whiteboard_timers(org_id,board_id,deadline) VALUES($1,$2,clock_timestamp()+$3*interval '1 second')
        ON CONFLICT(org_id,board_id) DO UPDATE SET deadline=EXCLUDED.deadline`,[p.orgId,boardId,input.durationSeconds]);
      return this.readTimer(s,p,boardId);
    });
  }
  stopTimer(p:Principal,boardId:string):Promise<C.Timer|null>{return this.db.withTenant(p.orgId,async s=>{
    if(await this.access(s,p,boardId,true)!=='owner')return null;
    await s.query('DELETE FROM whiteboard_timers WHERE org_id=$1 AND board_id=$2',[p.orgId,boardId]);
    return {deadline:null,running:false};
  });}
}
