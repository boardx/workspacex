import { describe, expect, it } from 'vitest';
import { computeMindmapLayout, mindmapHiddenIds, readMindmapTree, type WhiteboardObject } from '@repo/whiteboard-core';
import { planBoardMindmap, mindmapReparentTarget } from '@/components/whiteboard/board-mindmap-planner';
import { boardMindmapSource } from '@/components/whiteboard/board-mindmap-source';
import * as Y from 'yjs';
import { executeCommands, readObjects } from '@repo/whiteboard-core';
function apply(objects: WhiteboardObject[], action: Parameters<typeof planBoardMindmap>[1]): WhiteboardObject[] {
  const doc=new Y.Doc();
  if(objects.length)executeCommands(doc,objects.map(object=>({type:'create',object})), 'fixture');
  executeCommands(doc,planBoardMindmap(objects,action).commands, 'fixture-operation');
  const result=readObjects(doc);doc.destroy();return result;
}
function fixture(){let objects=apply([],{action:'create-root',id:'root',text:'中心主题',position:{x:10,y:20}});objects=apply(objects,{action:'add-child',nodeId:'root',id:'a',edgeId:'ra',text:'研究'});objects=apply(objects,{action:'add-sibling',nodeId:'a',id:'b',edgeId:'rb',text:'开发'});return objects;}
describe('native Board mindmap (#5682)',()=>{
  it('uses native sticky/curve objects and single authoritative parent edges',()=>{const objects=fixture(),tree=readMindmapTree(objects,'root');expect(tree.children.get('root')).toEqual(['a','b']);expect(tree.nodes.size).toBe(3);expect(tree.edges.size).toBe(2);expect(tree.nodes.get('root')!.geometry).toMatchObject({x:10,y:20});expect(objects.every(object=>object.parentId===null)).toBe(true);expect(tree.edges.get('ra')!.connector).toMatchObject({from:'root',to:'a',type:'curve'});});
  it('lays out variable-size trees deterministically without moving the root',()=>{const objects=fixture();objects.find(object=>object.id==='a')!.geometry.height=360;const first=computeMindmapLayout(objects,'root'),second=computeMindmapLayout(objects,'root');expect([...first]).toEqual([...second]);expect(first.get('root')).toEqual(objects.find(object=>object.id==='root')!.geometry);const a=first.get('a')!,b=first.get('b')!;expect(a.y+a.height).toBeLessThan(b.y);});
  it('collapse hides descendants and attached ordinary connectors without deleting structure',()=>{let objects=fixture();objects=apply(objects,{action:'add-child',nodeId:'a',id:'c',edgeId:'ac',text:'中文 mixed'});const before=boardMindmapSource(objects,'root');objects=apply(objects,{action:'set-collapsed',nodeId:'a',collapsed:true});expect([...mindmapHiddenIds(objects)].sort()).toEqual(['ac','c']);expect(objects).toHaveLength(7);expect(boardMindmapSource(objects,'root')).toBe(before);expect(objects.some(object=>object.hidden)).toBe(false);});
  it('reparents in one plan and preserves node and edge IDs',()=>{const objects=fixture();const next=apply(objects,{action:'reparent',nodeId:'a',newParentId:'b'});expect(next.map(object=>object.id).sort()).toEqual(objects.map(object=>object.id).sort());expect(readMindmapTree(next,'root').incoming.get('a')!.connector!.from).toBe('b');expect(()=>planBoardMindmap(next,{action:'reparent',nodeId:'b',newParentId:'a'})).toThrow();expect(()=>planBoardMindmap(objects,{action:'reparent',nodeId:'root',newParentId:'a'})).toThrow();});
  it('deletes a subtree atomically and refuses locked trees',()=>{const objects=fixture();expect(apply(objects,{action:'delete-subtree',nodeId:'a'}).map(object=>object.id).sort()).toEqual(['b','rb','root']);objects.find(object=>object.id==='b')!.locked=true;expect(()=>planBoardMindmap(objects,{action:'layout',treeId:'root'})).toThrow('MINDMAP_LOCKED');});
  it('deletes a full tree edge-first without duplicate cascaded deletes',()=>{const objects=fixture(),plan=planBoardMindmap(objects,{action:'delete-subtree',nodeId:'root'});expect(plan.commands.filter(command=>command.type==='delete').slice(0,2).map(command=>command.id).sort()).toEqual(['ra','rb']);expect(apply(objects,{action:'delete-subtree',nodeId:'root'})).toEqual([]);});
  it('places repeated creation and imports without overlapping existing widgets or moving their anchors',()=>{
    const objects=fixture(),rootBefore={...objects.find(object=>object.id==='root')!.geometry};
    const created=apply(objects,{action:'create-root',id:'second-root',text:'第二个主题',position:{x:10,y:20}});
    const second=created.find(object=>object.id==='second-root')!.geometry;
    for(const old of objects.filter(object=>object.kind==='sticky'))expect(second.y).toBeGreaterThan(old.geometry.y+old.geometry.height);
    expect(created.find(object=>object.id==='root')!.geometry).toEqual(rootBefore);
    const model={kind:'mindmap' as const,direction:'LR' as const,nodes:[{id:'n0',label:'导入根',shape:'sticky' as const,x:0,y:0,width:180,height:180},{id:'n1',label:'导入子',shape:'sticky' as const,x:0,y:0,width:180,height:180}],edges:[{id:'e0',source:'n0',target:'n1',label:'',kind:'open' as const}]};
    const imported=apply(objects,{action:'import-mermaid',model,ids:{n0:'import-root',n1:'import-child'},edgeIds:{e0:'import-edge'},position:{x:10,y:20}});
    for(const node of imported.filter(object=>object.id.startsWith('import-')&&object.kind==='sticky'))for(const old of objects.filter(object=>object.kind==='sticky'))expect(node.geometry.y).toBeGreaterThan(old.geometry.y+old.geometry.height);
    expect(imported.find(object=>object.id==='root')!.geometry).toEqual(rootBefore);
  });
  it('exports tree source without geometry or collapsed node omission',()=>{const source=boardMindmapSource(fixture(),'root');expect(source).toContain('mindmap');expect(source).toContain('中心主题');expect(source).toContain('研究');expect(source).toContain('开发');expect(source).not.toMatch(/width|height|rotation|geometry/);});
  it('previews only a valid explicit reparent zone, excluding descendants and current parent',()=>{const objects=fixture();const b=objects.find(object=>object.id==='b')!;expect(mindmapReparentTarget(objects,'a',b.geometry)).toBe('b');expect(mindmapReparentTarget(objects,'root',b.geometry)).toBeNull();expect(mindmapReparentTarget(objects,'a',{...b.geometry,x:9999})).toBeNull();});
});
