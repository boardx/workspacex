import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { WhiteboardMindmapMetadata, WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { createWhiteboardDocument, executeCommands, readObjects, validateDocument, MindmapCommandPort, mindmapStateVector, mindmapStructureDigest } from '../src';
const geometry = {x:0,y:0,width:180,height:120,rotation:0};
const node = (id:string,treeId='root') => WhiteboardObject.parse({id,schemaVersion:1,kind:'sticky',geometry,text:id,style:{},extensionData:{mindmap:{version:1,role:'node',treeId,collapsed:false}}});
const edge = (id:string,from:string,to:string) => WhiteboardObject.parse({id,schemaVersion:1,kind:'connector',geometry,text:'',style:{},connector:{from,to,type:'curve',fromAnchor:'right',toAnchor:'left'},extensionData:{mindmap:{version:1,role:'edge',treeId:'root',siblingOrder:id}}});
const seed = () => {const doc=createWhiteboardDocument(); executeCommands(doc,[node('root'),node('a'),node('b'),edge('ra','root','a'),edge('ab','a','b')].map(object=>({type:'create',object})),'fixture');return doc;};
describe('native mindmap authority',()=>{
  it('rejects parent metadata duplication and wrong version',()=>{
    expect(WhiteboardMindmapMetadata.safeParse({version:1,role:'node',treeId:'root',collapsed:false,parentId:'a'}).success).toBe(false);
    expect(WhiteboardMindmapMetadata.safeParse({version:2,role:'node',treeId:'root',collapsed:false}).success).toBe(false);
  });
  it('rejects a complete cyclic batch atomically, preserving every object',()=>{
    const doc=seed(),before=Y.encodeStateAsUpdate(doc);
    expect(()=>executeCommands(doc,[{type:'connector',id:'ra',connector:{from:'b',to:'a'}}],'cycle')).toThrow('MINDMAP_CYCLE');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);doc.destroy();
  });
  it('rejects duplicate parents, free endpoints and stranded children',()=>{
    const doc=seed(),before=readObjects(doc);
    expect(()=>executeCommands(doc,[{type:'create',object:edge('rb','root','b')}],'duplicate')).toThrow('MINDMAP_MULTIPLE_PARENTS');
    expect(()=>executeCommands(doc,[{type:'connector',id:'ra',connector:{fromPoint:{x:0,y:0},to:'a'}}],'free')).toThrow('MINDMAP_INVALID_ENDPOINT');
    expect(()=>executeCommands(doc,[{type:'delete',id:'ra'}],'disconnect')).toThrow('MINDMAP_DISCONNECTED_NODE');
    expect(readObjects(doc)).toEqual(before);doc.destroy();
  });
  it('rejects an old planned version and makes a successful gesture idempotent',()=>{
    const doc=seed(),port=new MindmapCommandPort(doc),vector=mindmapStateVector(doc);
    const input={boardId:'board',clientId:'browser',gestureId:'collapse',command:{action:'set-collapsed' as const,treeId:'root',expectedStateVector:vector,commands:[{type:'extension' as const,id:'a',key:'mindmap',value:{version:1,role:'node',treeId:'root',collapsed:true}}]}};
    const receipt=port.dispatch(input);expect(port.dispatch(input)).toEqual(receipt);
    expect(()=>port.dispatch({...input,gestureId:'different'})).toThrow('MINDMAP_STALE_REVISION');doc.destroy();
  });
  it('persisted snapshots enforce the same structural authority; text does not change structural digest',()=>{
    const doc=seed(),digest=mindmapStructureDigest(readObjects(doc));
    executeCommands(doc,[{type:'text',id:'a',index:0,deleteCount:0,insert:'hello'}],'text');
    expect(mindmapStructureDigest(readObjects(doc))).toBe(digest);
    const restored=createWhiteboardDocument();Y.applyUpdate(restored,Y.encodeStateAsUpdate(doc));expect(()=>validateDocument(restored)).not.toThrow();
    const item=restored.getMap<Y.Map<unknown>>('objects').get('ra')!;item.set('connector',{from:'b',to:'a'});expect(()=>validateDocument(restored)).toThrow('MINDMAP_CYCLE');
    restored.destroy();doc.destroy();
  });
  it('domain intentions reject layout deletion and collapse reparenting before mutation',()=>{
    const doc=seed(),before=Y.encodeStateAsUpdate(doc),port=new MindmapCommandPort(doc);
    const envelope={boardId:'board',clientId:'browser',gestureId:'bad-action'};
    expect(()=>port.dispatch({...envelope,command:{action:'layout',treeId:'root',expectedStateVector:mindmapStateVector(doc),commands:[{type:'delete',id:'b'}]}})).toThrow();
    expect(()=>port.dispatch({...envelope,command:{action:'set-collapsed',treeId:'root',expectedStateVector:mindmapStateVector(doc),commands:[{type:'connector',id:'ab',connector:{from:'root',to:'b'}}]}})).toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);doc.destroy();
  });

});
