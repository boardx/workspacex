import {createHash} from 'node:crypto';
import {WHITEBOARD_SYNC} from '@repo/contracts/whiteboard-sync';
export type SnapshotReference={epoch:number;seq:number;key:string;hash:string;bytes:number};
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const snapshotDigest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export const snapshotPrefix=(orgId:string,boardId:string)=>`whiteboards/tenants/${snapshotDigest(orgId).slice(0,32)}/boards/${boardId}/`;
export const canonicalSnapshotKey=(orgId:string,boardId:string,value:Pick<SnapshotReference,'epoch'|'seq'|'hash'>)=>`${snapshotPrefix(orgId,boardId)}epochs/${value.epoch}/snapshots/${value.seq}-${value.hash}.yjs`;
/** Only server-published snapshot forms, never arbitrary board assets or URLs.
 * Checkpoint/restore keys predate the new epoch; capture binds verified bytes to
 * the current document epoch and sequence before retaining an Undo reference. */
export function validSnapshotReference(orgId:string,boardId:string,value:SnapshotReference,allowRecovery=false):boolean{
 if(!Number.isSafeInteger(value.epoch)||value.epoch<1||!Number.isSafeInteger(value.seq)||value.seq<0||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>WHITEBOARD_SYNC.documentBytes||! /^[a-f0-9]{64}$/.test(value.hash))return false;
 if(value.key===canonicalSnapshotKey(orgId,boardId,value))return true;
 const prefix=snapshotPrefix(orgId,boardId);
 if(!allowRecovery||!value.key.startsWith(prefix))return false;
 const suffix=value.key.slice(prefix.length);
 return new RegExp(`^(?:(?:checkpoints|restores)/${uuid}|epochs/${value.epoch}/recovered/${uuid})-${value.hash}\\.yjs$`).test(suffix);
}
