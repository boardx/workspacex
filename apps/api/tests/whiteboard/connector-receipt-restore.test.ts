import * as Y from 'yjs';
import { expect, it } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects, readStoredObject } from '@repo/whiteboard-core';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { WorkerWhiteboardUpdateValidator } from '../../src/infrastructure/whiteboard/update-validator';
function fixture(_includeConnector: boolean) {
 const doc=createWhiteboardDocument();
 executeCommands(doc,['circle','rectangle'].map((id,i)=>({type:'create' as const,object:{id,schemaVersion:1 as const,kind:'rectangle' as const,text:id,style:{},parentId:null,orderKey:id,geometry:{x:100+i*300,y:0,width:100,height:100,rotation:31}}})), 'fixture');
 executeCommands(doc,[{type:'create',object:{id:'edge',schemaVersion:1,kind:'connector',text:'relation',style:{stroke:'#112233'},parentId:null,orderKey:'edge',geometry:{x:100,y:0,width:300,height:100,rotation:0},connector:{from:'circle',to:'rectangle',type:'curve',route:{kind:'curve',startOffset:{x:90,y:-65},endOffset:{x:-40,y:120}},labelPosition:{t:.65,normalOffset:-14},strokeWidth:8,label:'relation'}}}], 'fixture');
 const bytes=Y.encodeStateAsUpdate(doc),objects=readObjects(doc);doc.destroy();return {bytes,objects};
}
function decode(bytes:Uint8Array){const doc=createWhiteboardDocument();try{Y.applyUpdate(doc,bytes);return readObjects(doc);}finally{doc.destroy();}}
it('receipt-authorized routed deletion undo derives current bounds without accepting forged inverse fields', async () => {
  const f = fixture(true), validator = new WorkerWhiteboardUpdateValidator();
  const deleted = await validator.commands(f.bytes, [{ type: 'delete', id: 'circle' }]);
  const moved = await validator.commands(deleted.snapshot, [{ type: 'geometry', id: 'rectangle', geometry: { ...f.objects.find(o => o.id === 'rectangle')!.geometry, x: 805 } }]);
  const restored = await validator.restoreDeletion(moved.snapshot, deleted.deletions!, deleted.deletionChanges);
  const edge = decode(restored.snapshot).find(o => o.id === 'edge')!;
  expect(edge.connector).toEqual(f.objects.find(o => o.id === 'edge')!.connector);
  expect(edge.geometry).not.toEqual(f.objects.find(o => o.id === 'edge')!.geometry);
  for (const field of ['text', 'style', 'connector', 'geometry']) {
    const doc = createWhiteboardDocument();
    try {
      Y.applyUpdate(doc, moved.snapshot);
      // Make forged LWW fields win against the disposable host's restore writes.
      doc.clientID = 0xffffffff;
      const vector = Y.encodeStateVector(doc), item = doc.getMap<Y.Map<unknown>>('objects').get('edge')!;
      if (field === 'text') (item.get('text') as Y.Text).insert(0, 'forged');
      else if (field === 'style') (item.get('style') as Y.Map<unknown>).set('stroke', '#ff0000');
      else if (field === 'connector') item.set('connector', { ...edge.connector, route: { kind: 'curve', startOffset: { x: 91, y: -65 }, endOffset: { x: -40, y: 120 } } });
      else item.set('geometry', { ...edge.geometry, x: edge.geometry.x + 1 });
      const inverse = Y.encodeStateAsUpdate(doc, vector), original = new Uint8Array(moved.snapshot);
      const candidate = createWhiteboardDocument();
      try {
        Y.applyUpdate(candidate, moved.snapshot);
        executeCommands(candidate, deleted.deletions!.map(p => ({ type: 'restore', id: p.id })), 'candidate');
        Y.applyUpdate(candidate, inverse);
        expect(readStoredObject(candidate, 'edge')![field as keyof WhiteboardObject], `forged ${field} must actually win`).toEqual(readStoredObject(doc, 'edge')![field as keyof WhiteboardObject]);
      } finally { candidate.destroy(); }
      await expect(validator.restoreDeletion(moved.snapshot, deleted.deletions!, deleted.deletionChanges, inverse)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(moved.snapshot).toEqual(original);
    } finally { doc.destroy(); }
  }
}, 30_000);

it('routed restore rejects mismatched receipts and unrelated writes while preserving a remote endpoint move', async () => {
  const f = fixture(true), validator = new WorkerWhiteboardUpdateValidator();
  const deleted = await validator.commands(f.bytes, [{ type: 'delete', id: 'circle' }]);
  const moved = await validator.commands(deleted.snapshot, [{ type: 'geometry', id: 'rectangle', geometry: { ...f.objects.find(o => o.id === 'rectangle')!.geometry, x: 805 } }]);
  await expect(validator.restoreDeletion(moved.snapshot, deleted.deletions!.map(p => ({ ...p, digest: '0'.repeat(64) })), deleted.deletionChanges)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  const doc = createWhiteboardDocument();
  try {
    Y.applyUpdate(doc, moved.snapshot); doc.clientID = 0xffffffff; const vector = Y.encodeStateVector(doc);
    (doc.getMap<Y.Map<unknown>>('objects').get('rectangle')!.get('style') as Y.Map<unknown>).set('fill', '#ff0000');
    await expect(validator.restoreDeletion(moved.snapshot, deleted.deletions!, deleted.deletionChanges, Y.encodeStateAsUpdate(doc, vector))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  } finally { doc.destroy(); }
  const restored = await validator.restoreDeletion(moved.snapshot, deleted.deletions!, deleted.deletionChanges);
  expect(decode(restored.snapshot).find(o => o.id === 'rectangle')!.geometry.x).toBe(805);
});
