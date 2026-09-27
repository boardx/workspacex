import type {BoardOrganizeActorDirectory} from '../../application/whiteboard/organize-service';
import type {DatabasePort} from '../../application/ports/database.port';
import type {Principal} from '../../domain/principal';
export class PgBoardOrganizeActorDirectory implements BoardOrganizeActorDirectory {
  constructor(private db:DatabasePort){}
  async list(p:Principal){return this.db.withTenant(p.orgId,async s=>(await s.query<{actor_id:string}>(`SELECT actor_id FROM whiteboard_actor_identities WHERE org_id=$1 AND delegated_by=$2 AND enabled=true AND kind='ai' ORDER BY actor_id LIMIT 50`,[p.orgId,p.userId])).rows.map(row=>row.actor_id));}
}
