import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { importPreview, parsePortableImport, remapPortableObjects } from '../../src/application/whiteboard/portable-board';
import { WhiteboardTransferError } from '../../src/application/whiteboard/transfer-ports';

const geometry = { x: 1, y: 2, width: 200, height: 100, rotation: 0 };
const objects = [
  { id:'frame',schemaVersion:1 as const,kind:'frame' as const,geometry,text:'Frame',style:{},parentId:null,orderKey:'a',extensionData:{ plugin:'safe', nested:[1,true] } },
  { id:'group',schemaVersion:1 as const,kind:'group' as const,geometry,text:'Group',style:{},parentId:'frame',orderKey:'b' },
  { id:'note',schemaVersion:1 as const,kind:'sticky' as const,geometry,text:'Idea',style:{fill:'#fff'},parentId:'group',orderKey:'c' },
  { id:'line',schemaVersion:1 as const,kind:'connector' as const,geometry,text:'',style:{},parentId:null,orderKey:'d',connector:{from:'frame',to:'note'} },
];
const input = (items: unknown = objects) => ({ requestId:randomUUID(),package:{format:'workspacex.board',schemaVersion:1,exportedAt:new Date().toISOString(),source:{application:'WorkspaceX',boardId:randomUUID(),name:'Portable'},objects:items,provenance:{objectCount:Array.isArray(items)?items.length:0,contentModel:'whiteboard-object.v1'}} });

describe('portable board validate-first import', () => {
  it('remaps every identity and all parent/connector references without losing extension data', () => {
    const parsed=parsePortableImport(input()), ids=['new-frame','new-group','new-note','new-line'];let i=0;
    const mapped=remapPortableObjects(parsed.package.objects,()=>ids[i++]!);
    expect(mapped.map(o=>o.id)).toEqual(ids);
    expect(mapped.find(o=>o.id==='new-group')?.parentId).toBe('new-frame');
    expect(mapped.find(o=>o.id==='new-note')?.parentId).toBe('new-group');
    expect(mapped.find(o=>o.kind==='connector')?.connector).toEqual({from:'new-frame',to:'new-note'});
    expect(mapped[0]?.extensionData).toEqual(objects[0]!.extensionData);
    expect(importPreview(parsed)).toMatchObject({objectCount:4,frameCount:1,groupCount:1,connectorCount:1,identitiesRemapped:4,contentLosses:[]});
  });
  it('rejects dangling, cyclic and duplicate references before any write', () => {
    for (const invalid of [
      objects.map(o=>o.id==='note'?{...o,parentId:'missing'}:o),
      objects.map(o=>o.id==='line'?{...o,connector:{from:'missing',to:'note'}}:o),
      objects.map(o=>o.id==='frame'?{...o,parentId:'group'}:o),
      [...objects,objects[0]],
    ]) expect(()=>parsePortableImport(input(invalid))).toThrow(WhiteboardTransferError);
  });
  it('rejects unknown schema versions and oversized packages with one generic validation code', () => {
    expect(()=>parsePortableImport({...input(),package:{...input().package,schemaVersion:2}})).toThrowError(expect.objectContaining({code:'VALIDATION_FAILED'}));
    expect(()=>parsePortableImport(input([{...objects[2],text:'x'.repeat(16*1024*1024)}]))).toThrowError(expect.objectContaining({code:'VALIDATION_FAILED'}));
  });
});
