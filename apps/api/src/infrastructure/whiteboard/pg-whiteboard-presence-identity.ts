import type { DatabasePort } from "../../application/ports/database.port";
import type { WhiteboardPresenceIdentity, WhiteboardPresenceIdentityResolver } from "../../application/whiteboard/collaboration-ports";
import type { Principal } from "../../domain/principal";

export class PgWhiteboardPresenceIdentity implements WhiteboardPresenceIdentityResolver {
  constructor(private readonly db:DatabasePort){}
  async resolve(p:Principal):Promise<WhiteboardPresenceIdentity>{
    if(p.userId.startsWith("agent:"))return{displayName:p.userId.slice(6)||"AI Agent",avatarUrl:null,principalKind:"agent"};
    return this.db.withTenant(p.orgId,async session=>{const result=await session.query<{display_name:string;avatar_url:string|null}>(`SELECT display_name,avatar_url FROM credentials WHERE user_id=$1`,[p.userId]);const row=result.rows[0];return{displayName:row?.display_name||p.userId,avatarUrl:row?.avatar_url??null,principalKind:"user"};});
  }
}
