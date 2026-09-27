import type { ObjectStore } from '../../application/artifact/ports';
import type { PhysicalPurgePort } from '../../application/files/physical-delete-ports';
import { WhiteboardObjectSweeper } from '../../application/whiteboard/object-retention';
import type { DatabasePort } from '../../application/ports/database.port';
import { PgWhiteboardObjectSweepRepository } from './pg-object-retention';

/**
 * Tenant-scoped scheduler target. The scheduler supplies a trusted tenant identity; this
 * function never enumerates tenants and the ordinary request graph never receives purge.
 */
export async function maintainWhiteboardObjectPurge(
  db:DatabasePort,objects:Pick<ObjectStore,'head'>,purge:PhysicalPurgePort,orgId:string,limit=100,
){
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('WHITEBOARD_GC_INVALID_LIMIT');
  return new WhiteboardObjectSweeper(new PgWhiteboardObjectSweepRepository(db),objects,purge).run(orgId,limit);
}
