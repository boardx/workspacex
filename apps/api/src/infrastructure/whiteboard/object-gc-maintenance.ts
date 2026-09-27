import type { PhysicalPurgePort } from '../../application/files/physical-delete-ports';
import { WhiteboardObjectGarbageCollector,WhiteboardObjectSweeper,type WhiteboardObjectInventory } from '../../application/whiteboard/object-retention';
import type { DatabasePort } from '../../application/ports/database.port';
import { PgWhiteboardObjectRetentionRepository,PgWhiteboardObjectSweepRepository } from './pg-object-retention';

/**
 * Tenant-scoped scheduler target. The scheduler supplies a trusted tenant identity; this
 * function never enumerates tenants and the ordinary request graph never receives purge.
 */
export async function maintainWhiteboardObjectPurge(
  db:DatabasePort,objects:WhiteboardObjectInventory,purge:PhysicalPurgePort&Required<Pick<PhysicalPurgePort,'purgeExact'>>,orgId:string,tenantHash:string,runId:string,limit=100,
){
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('WHITEBOARD_GC_INVALID_LIMIT');
  const collected=await new WhiteboardObjectGarbageCollector(new PgWhiteboardObjectRetentionRepository(db),objects).collect(orgId,tenantHash,runId),purged=await new WhiteboardObjectSweeper(new PgWhiteboardObjectSweepRepository(db),objects,purge).run(orgId,limit);return{collected,purged};
}
