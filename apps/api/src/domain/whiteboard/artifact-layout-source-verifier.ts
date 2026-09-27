import { templateToModel } from '@repo/fabric-markdown/templates';
import { extractMermaidBlocks } from '@repo/fabric-markdown/markdown';
import { modelToMermaid } from '@repo/fabric-markdown/mermaid-serializer';
import type { DiagramModel, DiagramNode, DiagramEdge, Direction, EdgeKind, NodeShape } from '@repo/fabric-markdown/model';
import type { RenderedDiagramLayout } from '@repo/contracts/whiteboard-operation';

const DIRECTIONS = new Set<Direction>(['TD','TB','LR','RL','BT']);
const SHAPES = new Set<NodeShape>(['rect','round','stadium','diamond','circle','class','stateStart','stateEnd','participant','pieSlice','text','sticky','image']);
const EDGE_KINDS = new Set<EdgeKind>(['arrow','open','dotted','thick','inheritance','realization','composition','aggregation','dependency']);

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined;
  try { const parsed: unknown = JSON.parse(value); return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string,unknown> : undefined; }
  catch { return undefined; }
}
function normalized(source:string):string{return source.replace(/\r\n/g,'\n').trim();}

/**
 * A chat artifact stores the source markdown, not a client assertion about a rendered digest.
 * Recreate the serializer's logical model from the submitted Fabric snapshot and require that
 * its canonical source is the exact immutable fenced block. Geometry remains part of the signed
 * layout digest, while node/edge identity and content are anchored to server-read artifact bytes.
 */
export function artifactSourceMatchesLayout(bytes:Uint8Array,layout:RenderedDiagramLayout):boolean{
  const text=new TextDecoder().decode(bytes);
  try { if(normalized(JSON.stringify(JSON.parse(text)))===normalized(JSON.stringify(layout)))return true; } catch { /* source markdown is the normal Chat path */ }
  const blocks=extractMermaidBlocks(text);
  if(blocks.length!==1)return false;
  const nodes:DiagramNode[]=[],edges:DiagramEdge[]=[];
  let direction:Direction='TD',meta:Record<string,unknown>|undefined;
  for(const object of layout.objects){
    if(object.kind==='node'){
      const candidateDirection=object.style['direction'];
      if(typeof candidateDirection==='string'&&DIRECTIONS.has(candidateDirection as Direction))direction=candidateDirection as Direction;
      const candidateShape=object.style['shape'];
      if(typeof candidateShape!=='string'||!SHAPES.has(candidateShape as NodeShape))return false;
      meta??=jsonRecord(object.style['modelMetaJson']);
      nodes.push({id:object.sourceId,label:object.text,shape:candidateShape as NodeShape,x:object.geometry.x+object.geometry.width/2,y:object.geometry.y+object.geometry.height/2,width:object.geometry.width,height:object.geometry.height,...(typeof object.style['lifelineHeight']==='number'?{lifelineHeight:object.style['lifelineHeight']}:{}),...(jsonRecord(object.style['dataJson'])===undefined?{}:{data:jsonRecord(object.style['dataJson'])})});
    }else if(object.kind==='edge'){
      if(!object.fromSourceId||!object.toSourceId)return false;
      const candidateKind=object.style['edgeKind'];
      if(typeof candidateKind!=='string'||!EDGE_KINDS.has(candidateKind as EdgeKind))return false;
      edges.push({id:object.sourceId,source:object.fromSourceId,target:object.toSourceId,label:object.text||undefined,kind:candidateKind as EdgeKind,...(typeof object.style['sourceLabel']==='string'?{sourceLabel:object.style['sourceLabel']}:{}),...(typeof object.style['targetLabel']==='string'?{targetLabel:object.style['targetLabel']}:{}),...(typeof object.style['order']==='number'?{order:object.style['order']}:{}),...(typeof object.style['seqY']==='number'?{seqY:object.style['seqY']}:{}),...(jsonRecord(object.style['dataJson'])===undefined?{}:{data:jsonRecord(object.style['dataJson'])})});
    }else return false;
  }
  const kind:DiagramModel['kind']=layout.diagramKind==='sequence'?'sequence':layout.diagramKind==='persona'?'template':'flowchart';
  const reconstructed:DiagramModel={kind,direction,nodes,edges,...(meta===undefined?{}:{meta})};
  const block=blocks[0]!;
  const expectedLang=layout.diagramKind==='persona'?'persona':'mermaid';
  const languageMatches=block.lang===expectedLang || (layout.diagramKind==='persona' && block.lang==='canvas');
  if(!languageMatches || normalized(block.code)!==normalized(modelToMermaid(reconstructed)))return false;
  if(layout.diagramKind==='persona'){
    // Template serializers intentionally ignore decorative nodes. Those nodes still
    // become visible Board content, so bind their logical text/roles to the real
    // template expansion too; otherwise arbitrary extra labels could claim provenance.
    try {
      const expected=templateToModel(block.code,'persona');
      const profile=(node:DiagramNode)=>JSON.stringify({shape:node.shape,label:node.label,role:node.data?.['role']??null,key:node.data?.['key']??null,name:node.data?.['name']??null});
      if(JSON.stringify(nodes.map(profile).sort())!==JSON.stringify(expected.nodes.map(profile).sort()))return false;
    }catch{return false;}
  }
  return true;
}
