import * as Y from 'yjs';
import {WhiteboardUndo,rotatedAnchorPoint} from '@repo/whiteboard-core';
import {toBoardFabricObjects} from '../../components/whiteboard/whiteboard-fabric-projection';
import { artifactSourceMatchesLayout } from '../../../../apps/api/src/domain/whiteboard/artifact-layout-source-verifier';
import { describe, expect, it } from 'vitest';
import { renderedDiagramLayout, diagramModelFromBoardObjects } from '../../lib/chat-board-diagram-layout';
import { renderedLayoutToCommands } from '../../../../packages/whiteboard-core/src/artifact-handoff';
import { createWhiteboardDocument, executeCommands, readObjects } from '../../../../packages/whiteboard-core/src/document';
import { modelToMermaid } from '@repo/fabric-markdown/mermaid-serializer';
import { personaToModel } from '@repo/fabric-markdown/diagrams/persona';
import type { DiagramModel } from '@repo/fabric-markdown/model';
import type { WhiteboardOperationActor } from '@repo/contracts/whiteboard-operation';
const actor: WhiteboardOperationActor = {kind:'human',actorId:'user',orgId:'org',role:'owner',scopes:['artifact:read','board:write'],delegatedBy:null};
const flow: DiagramModel = {kind:'flowchart',direction:'LR',nodes:[{id:'a',label:'开始',shape:'round',x:100,y:100,width:120,height:60},{id:'b',label:'判断',shape:'diamond',x:380,y:160,width:120,height:80}],edges:[{id:'e',source:'a',target:'b',label:'检查',kind:'dotted'}]};
const sequence: DiagramModel = {kind:'sequence',direction:'LR',nodes:[{id:'a',label:'用户',shape:'participant',x:100,y:40,width:100,height:40,lifelineHeight:240},{id:'b',label:'服务',shape:'participant',x:350,y:40,width:100,height:40,lifelineHeight:240}],edges:[{id:'e1',source:'a',target:'b',label:'请求',kind:'arrow',order:0,seqY:140},{id:'e2',source:'b',target:'a',label:'返回',kind:'dotted',order:1,seqY:220}]};
const persona = personaToModel('姓名: 王晓明\n职位: 产品经理\n\n用户描述:\n- 远程协作\n\n目标和需求:\n- 保持布局');
function endpoints(objects:ReturnType<typeof readObjects>,id:string){const c=objects.find(o=>o.id===id)!.connector!;const at=(end:'from'|'to')=>c[end]?rotatedAnchorPoint(objects.find(o=>o.id===c[end])!,c[end==='from'?'fromAnchor':'toAnchor']??'center',c[end==='from'?'fromOffset':'toOffset']):c[end==='from'?'fromPoint':'toPoint'];return{fromPoint:at('from'),toPoint:at('to')};}
function transport(model: DiagramModel) {
  const layout=renderedDiagramLayout(model,'artifact','org','artifact-v1:1');
  const commands=renderedLayoutToCommands(layout,actor,'org',{x:30,y:70});
  const doc=createWhiteboardDocument();
  executeCommands(doc,commands,'chat-roundtrip-test');
  const objects=readObjects(doc); doc.destroy();
  return {layout,objects};
}
describe('Chat rendered model to canonical objects and editable source',()=>{
  it.each([['flowchart',flow],['sequence',sequence],['persona',persona]] as const)('roundtrips %s through a real Y.Doc preserving all text, source identities, layout and relationships',(_family,model)=>{
    const {layout,objects}=transport(model);
    expect(artifactSourceMatchesLayout(new TextEncoder().encode(`\`\`\`${model.kind==='template'?'persona':'mermaid'}\n${modelToMermaid(model)}\n\`\`\``),layout)).toBe(true);
    const restored=diagramModelFromBoardObjects(objects,'artifact');
    expect(modelToMermaid(restored)).toBe(modelToMermaid(model));
    expect(restored.nodes).toHaveLength(model.nodes.length);
    restored.nodes.forEach((node,index)=>{const original=model.nodes[index]!;expect(node).toMatchObject({id:original.id,label:original.label,shape:original.shape,width:original.width,height:original.height});expect(node.x).toBeCloseTo(original.x+30,10);expect(node.y).toBeCloseTo(original.y+70,10);});
    expect(restored.edges.map(e=>[e.source,e.target,e.label,e.kind])).toEqual(model.edges.map(e=>[e.source,e.target,e.label,e.kind]));
    expect(objects.filter(o=>(o.extensionData?.content as Record<string,unknown>)?.type==='artifact')).toHaveLength(layout.objects.length);
  });
  it('binds persona decoration text too and accepts the real canvas/persona fence alias',()=>{
    const {layout}=transport(persona);
    const bytes=new TextEncoder().encode(`\`\`\`canvas\n${modelToMermaid(persona)}\n\`\`\``);
    expect(artifactSourceMatchesLayout(bytes,layout)).toBe(true);
    const forged={...layout,objects:layout.objects.map((object,index)=>index===0?{...object,text:'untrusted decoration'}:object)};
    expect(artifactSourceMatchesLayout(bytes,forged)).toBe(false);
  });
  it('materializes shape variants and dotted labelled canonical connections',()=>{
    const {objects}=transport(flow);
    expect(objects[0]?.extensionData?.contentObject).toMatchObject({type:'shape',variant:'rounded-rectangle'});
    expect(objects[1]?.extensionData?.contentObject).toMatchObject({type:'shape',variant:'diamond'});
    expect(objects[2]?.connector).toMatchObject({from:'artifact_artifact_a',to:'artifact_artifact_b',lineStyle:'dotted',label:'检查'});
  });
  it('keeps sequence message y positions separate and creates real lifelines',()=>{
    const {objects}=transport(sequence);
    expect(objects.filter(o=>(o.extensionData?.content as Record<string,unknown>)?.type==='artifact-helper')).toHaveLength(2);
    expect(endpoints(objects,'artifact_artifact_e1')).toMatchObject({fromPoint:{x:130,y:210},toPoint:{x:380,y:210}});
    expect(endpoints(objects,'artifact_artifact_e2')).toMatchObject({fromPoint:{x:380,y:290},toPoint:{x:130,y:290}});
  });
  it('keeps a self-message as a real return loop rather than a vertical collapsed line',()=>{
    const model={...sequence,edges:[{id:'self',source:'a',target:'a',label:'内部调用',kind:'arrow' as const,order:0,seqY:150}]};
    const {objects}=transport(model);
    const start=objects.find(object=>object.id==='artifact_artifact_self')!;
    const end=objects.find(object=>object.id==='artifact_artifact_self_return')!;
    expect(endpoints(objects,start.id)).toEqual({fromPoint:{x:130,y:220},toPoint:{x:186,y:248}});expect(start.connector).toMatchObject({type:'elbow',endStyle:'none'});
    expect(endpoints(objects,end.id)).toEqual({fromPoint:{x:186,y:248},toPoint:{x:130,y:248}});expect(end.connector).toMatchObject({endStyle:'arrow'});
    expect(modelToMermaid(diagramModelFromBoardObjects(objects,'artifact'))).toBe(modelToMermaid(model));
  });
  it('follows participant moves with distinct relative message times, lifelines, self loops and durable undo',()=>{
    const model={...sequence,edges:[...sequence.edges,{id:'self',source:'a',target:'a',label:'内部调用',kind:'arrow' as const,order:2,seqY:260}]};
    const layout=renderedDiagramLayout(model,'artifact','org','artifact-v1:1'),doc=createWhiteboardDocument();
    executeCommands(doc,renderedLayoutToCommands(layout,actor,'org',{x:30,y:70}),{});
    const before=readObjects(doc),participant=before.find(o=>o.id==='artifact_artifact_a')!,undo=new WhiteboardUndo(doc);
    const affected=['artifact_artifact_e1','artifact_artifact_e2','artifact_artifact_self','artifact_artifact_self_return','artifact_artifact_a_lifeline'];
    undo.execute([{type:'geometry',id:participant.id,geometry:{...participant.geometry,x:participant.geometry.x+80,y:participant.geometry.y+35}}]);
    const moved=readObjects(doc);
    for(const id of affected){const edge=moved.find(o=>o.id===id)!,old=endpoints(before,id),next=endpoints(moved,id);
      for(const end of ['from','to'] as const){const key=end==='from'?'fromPoint':'toPoint',delta=edge.connector![end]===participant.id?{x:80,y:35}:{x:0,y:0};expect(next[key]).toEqual({x:old[key]!.x+delta.x,y:old[key]!.y+delta.y});}
      const scene=toBoardFabricObjects(moved).find(o=>o.id===id)!;expect(scene.connector).toMatchObject({start:next.fromPoint,end:next.toPoint});
    }
    expect(moved.find(o=>o.id==='artifact_artifact_b_lifeline')).toEqual(before.find(o=>o.id==='artifact_artifact_b_lifeline'));
    expect(modelToMermaid(diagramModelFromBoardObjects(moved,'artifact'))).toBe(modelToMermaid(model));
    expect(diagramModelFromBoardObjects(moved,'artifact').edges.map(e=>e.order)).toEqual([0,1,2]);
    expect((moved.find(o=>o.id==='artifact_artifact_e1')!.extensionData!.content as any).layoutHash).toBe(layout.layoutHash);
    const reopened=createWhiteboardDocument();Y.applyUpdate(reopened,Y.encodeStateAsUpdate(doc));expect(endpoints(readObjects(reopened),'artifact_artifact_self_return')).toEqual(endpoints(moved,'artifact_artifact_self_return'));reopened.destroy();
    expect(undo.undo()).toBe('undone');expect(readObjects(doc)).toEqual(before);expect(undo.redo()).toBe(true);expect(readObjects(doc)).toEqual(moved);undo.destroy();doc.destroy();
  });
  it('exports current canonical edits rather than replaying original source',()=>{
    const {objects}=transport(flow); objects[0]!.text='已编辑'; objects[0]!.geometry.x+=80;
    const restored=diagramModelFromBoardObjects(objects,'artifact');
    expect(restored.nodes[0]).toMatchObject({label:'已编辑',x:210});
    expect(modelToMermaid(restored)).toContain('已编辑');
  });
  it('refuses unsupported images/families and dangling exports instead of silently losing them',()=>{
    expect(()=>renderedDiagramLayout({...flow,nodes:[{...flow.nodes[0]!,shape:'image'}]},'a','org','r')).toThrow('UNSUPPORTED');
    expect(()=>renderedDiagramLayout({...flow,kind:'class'},'a','org','r')).toThrow('UNSUPPORTED');
    const {objects}=transport(flow);
    expect(()=>diagramModelFromBoardObjects(objects.filter(o=>o.id!=='artifact_artifact_a'),'artifact')).toThrow('DANGLING');
  });
});
