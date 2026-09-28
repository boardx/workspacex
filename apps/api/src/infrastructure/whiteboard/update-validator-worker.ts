import {createHash} from 'node:crypto';
import type {WhiteboardDeletionProof,WhiteboardDeletionChange} from '../../application/whiteboard/collaboration-ports';
import { parentPort, workerData } from 'node:worker_threads';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, prepareWhiteboardUpdate, validateDocument, readObjects, readStoredObject, WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import type { WhiteboardCommand } from '@repo/contracts/whiteboard-document';

const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(value);
const digest=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
type Input = {mode:'restore-deletion';snapshot:Uint8Array;proof:WhiteboardDeletionProof[];changes?:WhiteboardDeletionChange[];inverseUpdate?:Uint8Array} | { mode: 'objects'; snapshot: Uint8Array } | { mode: 'object-ids'; snapshot: Uint8Array } | { mode: 'update'; snapshot: Uint8Array; update: Uint8Array } | { mode: 'commands'; snapshot: Uint8Array; commands: WhiteboardCommand[] } | { mode: 'diff'; snapshot: Uint8Array; vector?: Uint8Array };
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
    const beforeById=new Map(before.map(object=>[object.id,object]));
    let update: Uint8Array;
    if(input.mode==='restore-deletion'){
      if(!input.proof.length||new Set(input.proof.map(p=>p.id)).size!==input.proof.length)throw new Error('RESTORE_PROOF');
      const tombstones=doc.getMap('deletedObjects');
      for(const proof of input.proof){const item=tombstones._map.get(proof.id);if(tombstones.get(proof.id)!==true||!item||item.id.client!==proof.tombstone.client||item.id.clock!==proof.tombstone.clock||digest(readStoredObject(doc,proof.id))!==proof.digest)throw new Error('RESTORE_CONFLICT');}
      const changes=input.changes??input.proof.map(proof=>({id:proof.id,before:proof.digest,after:null}));
      if(new Set(changes.map(change=>change.id)).size!==changes.length||input.proof.some(proof=>!changes.some(change=>change.id===proof.id&&change.before===proof.digest&&change.after===null)))throw new Error('RESTORE_CHANGES');
      for(const change of changes){const current=beforeById.get(change.id);if((current?digest(current):null)!==change.after)throw new Error('RESTORE_AFTER_CONFLICT');}
      const storedBefore=new Map([...doc.getMap('objects').keys()].map(id=>[id,digest(readStoredObject(doc,id))]));
      const vector=Y.encodeStateVector(doc);
      executeCommands(doc,input.proof.map(p=>({type:'restore',id:p.id})),'authorized-delete-undo');
      // The authority clears only receipt-proven tombstones first. The ordinary
      // validator then checks identities, limits and every other tombstone.
      if(input.inverseUpdate){const inverse=prepareWhiteboardUpdate(doc,input.inverseUpdate);Y.applyUpdate(doc,inverse);}
      const afterById=new Map(readObjects(doc).map(object=>[object.id,object]));
      const changeById=new Map(changes.map(change=>[change.id,change]));
      for(const change of changes){const final=afterById.get(change.id);if((final?digest(final):null)!==change.before)throw new Error('RESTORE_BEFORE_MISMATCH');}
      for(const id of new Set([...storedBefore.keys(),...doc.getMap('objects').keys()])){
        const change=changeById.get(id);
        // A created object undone by tombstoning must retain its exact stored
        // content; unrelated live AND hidden objects cannot be edited at all.
        if((!change||change.before===null)&&digest(readStoredObject(doc,id))!==storedBefore.get(id))throw new Error('RESTORE_EXTRA_WRITE');
        if(!change&&beforeById.has(id)!==afterById.has(id))throw new Error('RESTORE_EXTRA_VISIBILITY');
      }
      validateDocument(doc);update=Y.encodeStateAsUpdate(doc,vector);
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
    const afterById=new Map(readObjects(doc).map(object=>[object.id,object]));
    const deletionChanges=deletions.length?[...new Set([...beforeById.keys(),...afterById.keys()])].map(id=>({id,before:beforeById.has(id)?digest(beforeById.get(id)):null,after:afterById.has(id)?digest(afterById.get(id)):null})).filter(change=>change.before!==change.after):[];
    parentPort?.postMessage({ result: { snapshot, update, objectIds: [...afterById.keys()], deletions, deletionChanges } });
  }
} catch { parentPort?.postMessage({ rejected: true }); }
finally { doc.destroy(); }
