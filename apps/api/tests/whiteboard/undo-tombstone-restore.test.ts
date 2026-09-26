import { describe,expect,it } from 'vitest';
import { WhiteboardUndo,createWhiteboardDocument,executeCommands,readObjects } from '@repo/whiteboard-core';

const note=(id:string)=>({id,schemaVersion:1 as const,kind:'sticky' as const,geometry:{x:0,y:0,width:10,height:10,rotation:0},text:id,style:{},parentId:null,orderKey:id});

describe('authenticated tombstone restore semantics',()=>{
  it('undoes deletion with the original id and keeps connector references continuous',()=>{
    const doc=createWhiteboardDocument();executeCommands(doc,[{type:'create',object:note('target')},{type:'create',object:note('peer')},{type:'create',object:{...note('edge'),kind:'connector',connector:{from:'target',to:'peer',semanticRelation:'references'}}}],{});
    const undo=new WhiteboardUndo(doc);undo.execute([{type:'delete',id:'target'}]);expect(readObjects(doc).some(item=>item.id==='target')).toBe(false);
    expect(undo.undo('delete-receipt')).toBe('undone');expect(readObjects(doc).find(item=>item.id==='target')?.id).toBe('target');
    expect(readObjects(doc).find(item=>item.id==='edge')?.connector).toMatchObject({from:'target',to:'peer'});
    undo.destroy();doc.destroy();
  });
});
