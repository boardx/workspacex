import type { DatabasePort } from '../../application/ports/database.port';
import type { WhiteboardCollaborationStore } from '../../application/whiteboard/collaboration-ports';
import type { ObjectStore } from '../../application/artifact/ports';
import type { Principal } from '../../domain/principal';
import { PgWhiteboardRecoveryMetadata, CollaborationSnapshotSource } from './pg-recovery-metadata';
/** Reliable collaboration uses the same ObjectStore-backed recovery implementation. */
export class PgWhiteboardRecoveryAdapter extends PgWhiteboardRecoveryMetadata {
  private readonly snapshots:CollaborationSnapshotSource;
  constructor(db:DatabasePort,collaboration:WhiteboardCollaborationStore,objects?:Pick<ObjectStore,'get'>){super(db,objects);this.snapshots=new CollaborationSnapshotSource(collaboration);}
  snapshot(p:Principal,boardId:string,epoch:number,seq:number){return this.snapshots.snapshot(p,boardId,epoch,seq);}
}
