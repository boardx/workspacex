import {createHash} from 'node:crypto';
import type {WhiteboardDeletionProof} from '../../application/whiteboard/collaboration-ports';
import { parentPort, workerData } from 'node:worker_threads';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, prepareWhiteboardUpdate, validateDocument, readObjects, readStoredObject, WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import type { WhiteboardCommand } from '@repo/contracts/whiteboard-document';

const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(value);
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
type Input = {mode:'restore-deletion';snapshot:Uint8Array;proof:WhiteboardDeletionProof[]} | { mode: 'objects'; snapshot: Uint8Array } | { mode: 'object-ids'; snapshot: Uint8Array } | { mode: 'update'; snapshot: Uint8Array; update: Uint8Array } | { mode: 'commands'; snapshot: Uint8Array; commands: WhiteboardCommand[] } | { mode: 'diff'; snapshot: Uint8Array; vector?: Uint8Array };
const input = workerData as Input;
const doc = createWhiteboardDocument();
try {
  Y.applyUpdate(doc, input.snapshot);
  validateDocument(doc);
  if (input.mode === 'objects') {
    parentPort?.postMessage({ result: readObjects(doc) });
  } else if (input.mode === 'object-ids') {
    parentPort?.postMessage({ result: readObjects(doc).map(object => object.id) });
  } else if (input.mode === 'diff') {
    parentPort?.postMessage({ result: Y.encodeStateAsUpdate(doc, input.vector) });
  } else {
    const before=readObjects(doc);
    let update: Uint8Array;
    if(input.mode==='restore-deletion'){
      if(!input.proof.length||new Set(input.proof.map(p=>p.id)).size!==input.proof.length)throw new Error('RESTORE_PROOF');
      const tombstones=doc.getMap('deletedObjects');
      for(const proof of input.proof){const item=tombstones._map.get(proof.id);if(tombstones.get(proof.id)!==true||!item||item.id.client!==proof.tombstone.client||item.id.clock!==proof.tombstone.clock||digest(readStoredObject(doc,proof.id))!==proof.digest)throw new Error('RESTORE_CONFLICT');}
      const vector=Y.encodeStateVector(doc);executeCommands(doc,input.proof.map(p=>({type:'restore',id:p.id})),'authorized-delete-undo');update=Y.encodeStateAsUpdate(doc,vector);
    }else if (input.mode === 'update') { update = prepareWhiteboardUpdate(doc, input.update); Y.applyUpdate(doc, update); }
    else {
      const vector = Y.encodeStateVector(doc);
      executeCommands(doc, input.commands, 'authorized-host-command');
      update = Y.encodeStateAsUpdate(doc, vector);
    }
    const snapshot = Y.encodeStateAsUpdate(doc);
    if (snapshot.byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes || [...doc.store.clients.values()].reduce((n, values) => n + values.length, 0) > WHITEBOARD_UPDATE_LIMITS.documentStructs) throw new Error('LIMIT');
    const tombstones=doc.getMap('deletedObjects');
    const deletions=before.filter(object=>tombstones.get(object.id)===true).map(object=>{const item=tombstones._map.get(object.id)!;return{id:object.id,digest:digest(object),tombstone:{client:item.id.client,clock:item.id.clock}};});
    parentPort?.postMessage({ result: { snapshot, update, deletions } });
  }
} catch { parentPort?.postMessage({ rejected: true }); }
finally { doc.destroy(); }
