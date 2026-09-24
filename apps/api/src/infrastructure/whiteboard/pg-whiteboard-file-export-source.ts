import { whiteboard as W } from '@repo/contracts';
import type { Principal } from '../../domain/principal';
import type { DatabasePort } from '../../application/ports/database.port';
import { WhiteboardCollaborationError, type WhiteboardCollaborationStore, type WhiteboardUpdateValidator } from '../../application/whiteboard/collaboration-ports';
import { WhiteboardFileExportError as Fault, type WhiteboardFileExportSource } from '../../application/whiteboard/file-export-ports';

function mapError(error:unknown):never{
  if(error instanceof WhiteboardCollaborationError){if(error.code==='NOT_FOUND')throw new Fault('NOT_FOUND');if(error.code==='FORBIDDEN')throw new Fault('FORBIDDEN');throw new Fault('VALIDATION_FAILED');}throw error;
}

export class PgWhiteboardFileExportSource implements WhiteboardFileExportSource {
  constructor(private readonly db:DatabasePort,private readonly collaboration:WhiteboardCollaborationStore,private readonly validator:WhiteboardUpdateValidator){}
  async load(p:Principal,boardId:string){
    if(!W.BoardId.safeParse(boardId).success)throw new Fault('VALIDATION_FAILED');
    let state:Awaited<ReturnType<WhiteboardCollaborationStore['load']>>;try{state=await this.collaboration.load(p,boardId);}catch(error){mapError(error);}
    const objects=await this.validator.objects(state!.update);
    const metadata=await this.db.withTenant(p.orgId,async session=>{const result=await session.query<{name:string}>(`SELECT b.name FROM whiteboards b LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$3 WHERE b.org_id=$1 AND b.id=$2 AND (b.owner_id=$3 OR m.user_id IS NOT NULL)`,[p.orgId,boardId,p.userId]);if(!result.rows[0])throw new Fault('NOT_FOUND');return result.rows[0];});
    return{boardName:metadata.name,role:state!.role,objects};
  }
}
