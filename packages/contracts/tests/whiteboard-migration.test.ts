import { describe, expect, it } from 'vitest';
import * as C from '../src/whiteboard-migration';

describe('external whiteboard migration contracts', () => {
  it('accepts explicit versioned Miro and Mural snapshots', () => {
    expect(C.ExternalBoardSnapshot.parse({ format:'miro.rest.board-snapshot', schemaVersion:1, exportedAt:'2026-09-24T00:00:00.000Z', board:{id:'b',name:'Miro'}, pages:[{id:'p',items:[]}]}).format).toContain('miro');
    expect(C.ExternalBoardSnapshot.parse({ format:'mural.public-api.mural-snapshot', schemaVersion:1, exportedAt:'2026-09-24T00:00:00.000Z', drawingsIncluded:false, mural:{id:'m',name:'Mural'}, pages:[{id:'p',widgets:[]}]}).format).toContain('mural');
    expect(C.ExternalBoardSnapshot.safeParse({ format:'miro.rest.board-snapshot', schemaVersion:1, exportedAt:'2026-09-24T00:00:00.000Z', board:{id:'b',name:'Miro'}, pages:[{id:'p',items:[{id:'x',type:'sticky_note',createdAt:'2026-09-24T00:00:00Z',links:{self:'https://api.miro.com/v2/boards/b/sticky_notes/x'},data:{content:'ok',tagIds:['tag']},style:{fillColor:'#fff',fontFamily:'arial'},position:{x:0,y:0},geometry:{width:100,height:100}}]}] }).success).toBe(true);
  });

  it('rejects unversioned, forged and abnormal payloads', () => {
    const base = { format:'miro.rest.board-snapshot', schemaVersion:1, exportedAt:'2026-09-24T00:00:00.000Z', board:{id:'b',name:'Miro'}, pages:[{id:'p',items:[]}] };
    expect(C.ExternalBoardSnapshot.safeParse({ ...base, schemaVersion:2 }).success).toBe(false);
    expect(C.ExternalBoardSnapshot.safeParse({ ...base, admin:true }).success).toBe(false);
    expect(C.ExternalBoardSnapshot.safeParse({ ...base, pages:[{id:'p',items:[{id:'x',type:'sticky_note',position:{x:Infinity,y:0,width:1,height:1}}]}] }).success).toBe(false);
    expect(C.ExternalBoardSnapshot.safeParse({ ...base, pages:[{id:'p',items:[{id:'x',type:'sticky_note',position:{x:0,y:0,width:1,height:1},fillColor:'url(javascript:1)'}]}] }).success).toBe(false);
  });
});
