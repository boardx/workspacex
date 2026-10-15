import { readMindmapTree, type WhiteboardObject } from '@repo/whiteboard-core';
import { serializeMindmap } from '@repo/fabric-markdown/diagrams/mindmap';
import type { DiagramModel } from '@repo/fabric-markdown/model';
/** The Mermaid model is ephemeral; canonical coordinates never enter source. */
export function boardMindmapSource(objects: readonly WhiteboardObject[], treeId: string): string {
  const tree=readMindmapTree(objects,treeId);
  const edges: DiagramModel['edges']=[];
  const nodes: DiagramModel['nodes']=[];
  const visit=(id:string)=>{
    const object=tree.nodes.get(id)!;
    nodes.push({id,label:object.text,shape:'sticky',x:0,y:0,width:0,height:0,data:{mmType:0}});
    for(const child of tree.children.get(id)??[]){const edge=tree.incoming.get(child)!;edges.push({id:edge.id,source:id,target:child,label:'',kind:'open'});visit(child);}
  };visit(treeId);
  return serializeMindmap({kind:'mindmap',direction:'LR',nodes,edges});
}
