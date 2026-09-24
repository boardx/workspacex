import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { whiteboardRoom as C } from '@repo/contracts';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import type { Principal } from '../../domain/principal';
import { toOrgId } from '../../domain/org-id';
import { WhiteboardRoomError, type CreateRoomPairing, type JoinRoom, type PublishViewport, type RoomCredential, type WhiteboardRoomRepository } from '../../application/whiteboard/room-ports';

const PAIRING_TTL_MINUTES = 5;
const SESSION_TTL_HOURS = 4;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
type Access = { owner_id: string; archived: boolean; role: string | null };

export class PgWhiteboardRoomRepository implements WhiteboardRoomRepository {
  constructor(private readonly db: DatabasePort, private readonly secret: string) {}
  private hmac(value: string) { return createHmac('sha256', this.secret).update(value).digest('hex'); }
  private code(pairingId: string) {
    const bytes = createHmac('sha256', this.secret).update(`code:${pairingId}`).digest();
    return Array.from(bytes.subarray(0, 8), value => CODE_ALPHABET[value! % CODE_ALPHABET.length]).join('');
  }
  private tokenHash(token: string) { return this.hmac(`token:${token}`); }
  private equalHash(a: string, b: string) {
    const left=Buffer.from(a,'hex'), right=Buffer.from(b,'hex');
    return left.length===right.length && timingSafeEqual(left,right);
  }
  private async access(s: TenantSession, p: Principal, boardId: string, lock = false): Promise<Access | null> {
    const r=await s.query<Access>(`SELECT b.owner_id,b.archived,CASE WHEN b.owner_id=$2 THEN 'owner' ELSE m.role END role
      FROM whiteboards b LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$2
      WHERE b.org_id=$1 AND b.id=$3 AND (b.owner_id=$2 OR m.role IN ('editor','viewer')) ${lock?'FOR UPDATE OF b':''}`,[p.orgId,p.userId,boardId]);
    return r.rows[0]??null;
  }
  async createPairing(p: Principal, boardId: string, input: CreateRoomPairing): Promise<C.Pairing> {
    return this.db.withTenant(p.orgId, async s => {
      const access=await this.access(s,p,boardId,true);
      if(!access || access.archived || (access.role!=='owner' && access.role!=='editor')) throw new WhiteboardRoomError('not_found');
      const id=randomUUID(), code=this.code(id), codeHash=this.hmac(`code-value:${code}`);
      await s.query(`INSERT INTO whiteboard_room_pairings(id,org_id,board_id,created_by,request_id,code_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+interval '${PAIRING_TTL_MINUTES} minutes') ON CONFLICT(org_id,created_by,request_id) DO NOTHING`,[id,p.orgId,boardId,p.userId,input.requestId,codeHash]);
      const row=await s.query<{id:string;board_id:string;expires_at:Date}>(`SELECT id,board_id,expires_at FROM whiteboard_room_pairings WHERE org_id=$1 AND created_by=$2 AND request_id=$3`,[p.orgId,p.userId,input.requestId]);
      const pairing=row.rows[0]; if(!pairing || pairing.board_id!==boardId) throw new WhiteboardRoomError('not_found');
      const resolvedCode=this.code(pairing.id);
      await s.query(`INSERT INTO whiteboard_room_audit(org_id,board_id,actor_id,event) VALUES($1,$2,$3,'pairing_created')`,[p.orgId,boardId,p.userId]);
      return C.Pairing.parse({id:pairing.id,boardId,code:resolvedCode,payload:JSON.stringify({v:1,orgId:p.orgId,pairingId:pairing.id,code:resolvedCode}),expiresAt:pairing.expires_at.toISOString()});
    });
  }
  async pairingStatus(p: Principal, boardId: string, pairingId: string) {
    return this.db.withTenant(p.orgId,async s=>{
      const access=await this.access(s,p,boardId); if(!access||access.archived||(access.role!=='owner'&&access.role!=='editor'))throw new WhiteboardRoomError('not_found');
      const row=await s.query<{expires_at:Date;session_id:string|null}>(`SELECT rp.expires_at,rs.id session_id FROM whiteboard_room_pairings rp LEFT JOIN whiteboard_room_sessions rs ON rs.org_id=rp.org_id AND rs.pairing_id=rp.id
        WHERE rp.org_id=$1 AND rp.board_id=$2 AND rp.id=$3 AND rp.created_by=$4`,[p.orgId,boardId,pairingId,p.userId]);
      const value=row.rows[0];if(!value)throw new WhiteboardRoomError('not_found');
      return C.PairingStatus.parse({sessionId:value.session_id,joined:value.session_id!==null,expiresAt:value.expires_at.toISOString()});
    });
  }
  async join(input: JoinRoom, source: string): Promise<C.RoomGrant> {
    const orgId=toOrgId(input.orgId);
    const outcome = await this.db.withTenant<{grant:C.RoomGrant}|{error:'not_found'|'rate_limited'}>(orgId, async s => {
      const sourceHash=createHash('sha256').update(source).digest('hex');
      const pairing=await s.query<{id:string;board_id:string;created_by:string;code_hash:string;expires_at:Date}>(`SELECT id,board_id,created_by,code_hash,expires_at FROM whiteboard_room_pairings
        WHERE org_id=$1 AND id=$2 FOR UPDATE`,[input.orgId,input.pairingId]);
      const row=pairing.rows[0];
      if(row){
        await s.query(`INSERT INTO whiteboard_room_pairing_attempts(org_id,pairing_id,source_hash,attempts) VALUES($1,$2,$3,1)
          ON CONFLICT(org_id,pairing_id,source_hash) DO UPDATE SET attempts=CASE WHEN whiteboard_room_pairing_attempts.window_started_at<now()-interval '10 minutes' THEN 1 ELSE whiteboard_room_pairing_attempts.attempts+1 END,
          window_started_at=CASE WHEN whiteboard_room_pairing_attempts.window_started_at<now()-interval '10 minutes' THEN now() ELSE whiteboard_room_pairing_attempts.window_started_at END`,[input.orgId,input.pairingId,sourceHash]);
        const attempts=await s.query<{source_attempts:number;total_attempts:number}>(`SELECT
          COALESCE(max(attempts) FILTER (WHERE source_hash=$3 AND window_started_at>=now()-interval '10 minutes'),0)::int source_attempts,
          COALESCE(sum(attempts) FILTER (WHERE window_started_at>=now()-interval '10 minutes'),0)::int total_attempts
          FROM whiteboard_room_pairing_attempts WHERE org_id=$1 AND pairing_id=$2`,[input.orgId,input.pairingId,sourceHash]);
        if((attempts.rows[0]?.source_attempts??0)>8 || (attempts.rows[0]?.total_attempts??0)>30) return {error:'rate_limited'};
      }
      const supplied=this.hmac(`code-value:${input.code.toUpperCase()}`);
      if(!row || row.expires_at<=new Date() || !this.equalHash(row.code_hash,supplied)) return {error:'not_found'};
      const consumed=await s.query(`UPDATE whiteboard_room_pairings SET consumed_at=now() WHERE org_id=$1 AND id=$2 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING id`,[input.orgId,input.pairingId]);
      if(!consumed.rows.length) return {error:'not_found'};
      const board=await s.query<{name:string;archived:boolean;owner_id:string;role:string|null}>(`SELECT b.name,b.archived,b.owner_id,CASE WHEN b.owner_id=$3 THEN 'owner' ELSE m.role END role FROM whiteboards b
        LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$3 WHERE b.org_id=$1 AND b.id=$2`,[input.orgId,row.board_id,row.created_by]);
      const visible=board.rows[0]; if(!visible || visible.archived || (visible.role!=='owner'&&visible.role!=='editor')) return {error:'not_found'};
      const token=randomBytes(32).toString('base64url'), sessionId=randomUUID();
      const session=await s.query<{expires_at:Date}>(`INSERT INTO whiteboard_room_sessions(id,org_id,board_id,pairing_id,presenter_id,token_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+interval '${SESSION_TTL_HOURS} hours') RETURNING expires_at`,[sessionId,input.orgId,row.board_id,row.id,row.created_by,this.tokenHash(token)]);
      await s.query(`INSERT INTO whiteboard_room_audit(org_id,board_id,session_id,event) VALUES($1,$2,$3,'pairing_joined')`,[input.orgId,row.board_id,sessionId]);
      return {grant:C.RoomGrant.parse({orgId:input.orgId,sessionId,token,boardId:row.board_id,boardName:visible.name,expiresAt:session.rows[0]!.expires_at.toISOString(),role:'room-viewer'})};
    });
    if('error' in outcome)throw new WhiteboardRoomError(outcome.error);
    return outcome.grant;
  }
  async read(sessionId: string, credential: RoomCredential): Promise<C.RoomState> {
    return this.db.withTenant(toOrgId(credential.orgId), async s => {
      const tokenHash=this.tokenHash(credential.token);
      const result=await s.query<{board_id:string;name:string;expires_at:Date;epoch:number;seq:string;snapshot:Buffer|null;x:number|null;y:number|null;zoom:number|null;revision:string|null}>(`SELECT rs.board_id,b.name,rs.expires_at,COALESCE(d.epoch,0) epoch,COALESCE(d.seq,0) seq,d.snapshot,v.x,v.y,v.zoom,v.revision
        FROM whiteboard_room_sessions rs JOIN whiteboards b ON b.org_id=rs.org_id AND b.id=rs.board_id
        LEFT JOIN whiteboard_members m ON m.org_id=rs.org_id AND m.board_id=rs.board_id AND m.user_id=rs.presenter_id
        LEFT JOIN whiteboard_documents d ON d.org_id=rs.org_id AND d.board_id=rs.board_id
        LEFT JOIN whiteboard_room_viewports v ON v.org_id=rs.org_id AND v.session_id=rs.id
        WHERE rs.org_id=$1 AND rs.id=$2 AND rs.token_hash=$3 AND rs.revoked_at IS NULL AND rs.expires_at>now() AND b.archived=false
        AND (b.owner_id=rs.presenter_id OR m.role='editor')`,[credential.orgId,sessionId,tokenHash]);
      const row=result.rows[0]; if(!row) throw new WhiteboardRoomError('not_found');
      await s.query(`UPDATE whiteboard_room_sessions SET last_seen_at=now() WHERE org_id=$1 AND id=$2`,[credential.orgId,sessionId]);
      return C.RoomState.parse({boardId:row.board_id,boardName:row.name,snapshot:(row.snapshot??Buffer.alloc(0)).toString('base64'),epoch:row.epoch,seq:Number(row.seq),viewport:row.revision===null?null:{x:row.x,y:row.y,zoom:row.zoom,revision:Number(row.revision)},expiresAt:row.expires_at.toISOString()});
    });
  }
  async publishViewport(p: Principal, boardId: string, sessionId: string, input: PublishViewport): Promise<C.RoomViewport> {
    return this.db.withTenant(p.orgId, async s => {
      const access=await this.access(s,p,boardId,true); if(!access||access.archived||(access.role!=='owner'&&access.role!=='editor')) throw new WhiteboardRoomError('not_found');
      const session=await s.query(`SELECT id FROM whiteboard_room_sessions WHERE org_id=$1 AND board_id=$2 AND id=$3 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,[p.orgId,boardId,sessionId]);
      if(!session.rows.length) throw new WhiteboardRoomError('not_found');
      const row=await s.query<{x:number;y:number;zoom:number;revision:string}>(`INSERT INTO whiteboard_room_viewports(org_id,board_id,session_id,x,y,zoom) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(org_id,session_id) DO UPDATE SET x=EXCLUDED.x,y=EXCLUDED.y,zoom=EXCLUDED.zoom,revision=whiteboard_room_viewports.revision+1,updated_at=now() RETURNING x,y,zoom,revision`,[p.orgId,boardId,sessionId,input.x,input.y,input.zoom]);
      await s.query(`INSERT INTO whiteboard_room_audit(org_id,board_id,session_id,actor_id,event) VALUES($1,$2,$3,$4,'viewport_published')`,[p.orgId,boardId,sessionId,p.userId]);
      return C.RoomViewport.parse({...row.rows[0],revision:Number(row.rows[0]!.revision)});
    });
  }
  async revoke(p: Principal, boardId: string, sessionId: string): Promise<boolean> {
    return this.db.withTenant(p.orgId, async s => {
      const access=await this.access(s,p,boardId,true); if(!access||access.archived||(access.role!=='owner'&&access.role!=='editor')) return false;
      const row=await s.query(`UPDATE whiteboard_room_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE org_id=$1 AND board_id=$2 AND id=$3 RETURNING id`,[p.orgId,boardId,sessionId]);
      if(!row.rows.length)return false;
      await s.query(`INSERT INTO whiteboard_room_audit(org_id,board_id,session_id,actor_id,event) VALUES($1,$2,$3,$4,'session_revoked')`,[p.orgId,boardId,sessionId,p.userId]);
      return true;
    });
  }
}
