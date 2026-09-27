import type { ObjectStore } from '../artifact/ports';

export type WhiteboardObjectKind = 'document' | 'update' | 'checkpoint' | 'import' | 'asset';
export interface WhiteboardObjectRoot { key: string; kind: WhiteboardObjectKind }
export interface WhiteboardStoredObject { key: string; lastModified: Date; sizeBytes: number }

/** Read-only inventory capability; byte deletion stays outside the application runtime. */
export interface WhiteboardObjectInventory extends Pick<ObjectStore, 'head'> {
  list(prefix: string, cursor?: string): Promise<{ objects: WhiteboardStoredObject[]; cursor?: string }>;
}
export interface WhiteboardObjectRetentionRepository {
  roots(orgId: string): Promise<WhiteboardObjectRoot[]>;
  tombstones(orgId: string): Promise<Map<string, Date>>;
  mark(orgId: string, object: WhiteboardStoredObject, markedAt: Date): Promise<void>;
  unmark(orgId: string, keys: readonly string[]): Promise<void>;
  sweep(orgId: string, object: WhiteboardStoredObject, sweptAt: Date): Promise<void>;
  audit(orgId: string, runId: string, result: WhiteboardGcResult): Promise<void>;
}
export interface WhiteboardGcResult { roots: number; scanned: number; marked: number; swept: number; retained: number; candidateBytes: number }

/**
 * Deterministic mark/sweep. Sweep creates an audited lifecycle-policy candidate; it never
 * deletes bytes in the request process, so a stale inventory cannot destroy board data.
 */
export class WhiteboardObjectGarbageCollector {
  constructor(private readonly repository: WhiteboardObjectRetentionRepository,private readonly objects: WhiteboardObjectInventory,private readonly graceMs=86_400_000,private readonly now:()=>Date=()=>new Date()){
    if(!Number.isSafeInteger(graceMs)||graceMs<1)throw new Error('WHITEBOARD_GC_INVALID_GRACE');
  }
  async collect(orgId:string,tenantHash:string,runId:string):Promise<WhiteboardGcResult>{
    if(!/^[a-f0-9]{32}$/.test(tenantHash))throw new Error('WHITEBOARD_GC_INVALID_TENANT');
    const prefix=`whiteboards/tenants/${tenantHash}/`,[rootRows,tombstones]=await Promise.all([this.repository.roots(orgId),this.repository.tombstones(orgId)]),roots=new Set(rootRows.map(root=>root.key)),now=this.now();
    const result:WhiteboardGcResult={roots:roots.size,scanned:0,marked:0,swept:0,retained:0,candidateBytes:0};let cursor:string|undefined;const reachableTombstones:string[]=[];
    do{const page=await this.objects.list(prefix,cursor);cursor=page.cursor;for(const object of page.objects){
      if(!object.key.startsWith(prefix))throw new Error('WHITEBOARD_GC_SCOPE_VIOLATION');result.scanned++;
      if(roots.has(object.key)){result.retained++;if(tombstones.has(object.key))reachableTombstones.push(object.key);continue;}
      if(now.getTime()-object.lastModified.getTime()<this.graceMs){result.retained++;continue;}
      const markedAt=tombstones.get(object.key);if(!markedAt){await this.repository.mark(orgId,object,now);result.marked++;continue;}
      if(now.getTime()-markedAt.getTime()<this.graceMs){result.retained++;continue;}
      await this.repository.sweep(orgId,object,now);result.swept++;result.candidateBytes+=object.sizeBytes;
    }}while(cursor);
    if(reachableTombstones.length)await this.repository.unmark(orgId,reachableTombstones);
    await this.repository.audit(orgId,runId,result);return result;
  }
}
