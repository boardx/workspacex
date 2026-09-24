import type { DatabasePort } from '../../application/ports/database.port';
import type { Principal } from '../../domain/principal';
import type { MiroAuditAction, MiroAuthorizationState, MiroCredentialRepository, SealedMiroCredential } from '../../application/whiteboard/miro-ports';

type CredentialRow={sealed_credentials:string;scopes:string[];connected_at:Date;expires_at:Date|null;revision:number};
const view=(row:CredentialRow):SealedMiroCredential=>({sealed:row.sealed_credentials,scopes:row.scopes,connectedAt:new Date(row.connected_at).toISOString(),expiresAt:row.expires_at?new Date(row.expires_at).toISOString():null,revision:row.revision});

export class PgMiroCredentialRepository implements MiroCredentialRepository {
  constructor(private readonly db:DatabasePort) {}
  async createState(p:Principal,stateHash:string,returnTo:string,expiresAt:Date):Promise<void>{
    await this.db.withTenant(p.orgId,s=>s.query(`INSERT INTO whiteboard_miro_oauth_states(org_id,actor_id,state_hash,return_to,expires_at) VALUES($1,$2,$3,$4,$5)`,[p.orgId,p.userId,stateHash,returnTo,expiresAt]));
  }
  async consumeState(p:Principal,stateHash:string,now:Date):Promise<MiroAuthorizationState|null>{
    return this.db.withTenant(p.orgId,async s=>{
      const result=await s.query<{return_to:string}>(`UPDATE whiteboard_miro_oauth_states SET consumed_at=$4 WHERE org_id=$1 AND actor_id=$2 AND state_hash=$3 AND consumed_at IS NULL AND expires_at>$4 RETURNING return_to`,[p.orgId,p.userId,stateHash,now]);
      return result.rows[0]?{returnTo:result.rows[0].return_to}:null;
    });
  }
  async save(p:Principal,value:Omit<SealedMiroCredential,'revision'>):Promise<void>{
    await this.db.withTenant(p.orgId,s=>s.query(`INSERT INTO whiteboard_miro_credentials(org_id,actor_id,sealed_credentials,scopes,connected_at,expires_at,revision,revoked_at) VALUES($1,$2,$3,$4,$5,$6,1,NULL) ON CONFLICT(org_id,actor_id) DO UPDATE SET sealed_credentials=EXCLUDED.sealed_credentials,scopes=EXCLUDED.scopes,connected_at=EXCLUDED.connected_at,expires_at=EXCLUDED.expires_at,revision=whiteboard_miro_credentials.revision+1,revoked_at=NULL`,[p.orgId,p.userId,value.sealed,value.scopes,value.connectedAt,value.expiresAt]));
  }
  async load(p:Principal):Promise<SealedMiroCredential|null>{
    return this.db.withTenant(p.orgId,async s=>{const result=await s.query<CredentialRow>(`SELECT sealed_credentials,scopes,connected_at,expires_at,revision FROM whiteboard_miro_credentials WHERE org_id=$1 AND actor_id=$2 AND revoked_at IS NULL`,[p.orgId,p.userId]);return result.rows[0]?view(result.rows[0]):null;});
  }
  async rotate(p:Principal,expectedRevision:number,value:Omit<SealedMiroCredential,'revision'|'connectedAt'>):Promise<boolean>{
    return this.db.withTenant(p.orgId,async s=>(await s.query(`UPDATE whiteboard_miro_credentials SET sealed_credentials=$4,scopes=$5,expires_at=$6,revision=revision+1 WHERE org_id=$1 AND actor_id=$2 AND revision=$3 AND revoked_at IS NULL RETURNING actor_id`,[p.orgId,p.userId,expectedRevision,value.sealed,value.scopes,value.expiresAt])).rows.length===1);
  }
  async revoke(p:Principal):Promise<SealedMiroCredential|null>{
    return this.db.withTenant(p.orgId,async s=>{const result=await s.query<CredentialRow>(`UPDATE whiteboard_miro_credentials SET revoked_at=clock_timestamp(),revision=revision+1 WHERE org_id=$1 AND actor_id=$2 AND revoked_at IS NULL RETURNING sealed_credentials,scopes,connected_at,expires_at,revision`,[p.orgId,p.userId]);return result.rows[0]?view(result.rows[0]):null;});
  }
  async audit(p:Principal,action:MiroAuditAction,sourceBoardId?:string,objectCount?:number):Promise<void>{
    await this.db.withTenant(p.orgId,s=>s.query(`INSERT INTO whiteboard_miro_audit(org_id,actor_id,action,source_board_id,object_count) VALUES($1,$2,$3,$4,$5)`,[p.orgId,p.userId,action,sourceBoardId??null,objectCount??null]));
  }
}
