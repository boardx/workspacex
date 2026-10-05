'use client';
import {useId,type PointerEvent} from 'react';
import {connectorLabelPlacement,connectorPathHandles,connectorPathToSvg,scenePointFromLocal,type ConnectorRelationship,type ResolvedConnectorPath,type WhiteboardObject} from '@repo/whiteboard-core';
import {WHITEBOARD_CONNECTOR_LIMITS} from '@repo/contracts/whiteboard-document';
import type {BoardViewport} from './fabric/board-fabric-object';

export type ConnectorHandleKind='from'|'to'|'route'|'label'|'translate';
export type ConnectorOverlayPointerEvent=PointerEvent<HTMLElement|SVGElement>;
export interface BoardConnectorHandlesProps{
 viewport:BoardViewport;
 path:ResolvedConnectorPath|null;
 relationship:ConnectorRelationship|null;
 color:string;
 canEdit:boolean;
 active:boolean;
 snapCandidate?:{id:string;geometry:WhiteboardObject['geometry']}|null;
 onPointerDown:(kind:ConnectorHandleKind,handleId:string|null,event:ConnectorOverlayPointerEvent)=>void;
 onPointerMove:(event:ConnectorOverlayPointerEvent)=>void;
 onPointerUp:(event:ConnectorOverlayPointerEvent)=>void;
 onPointerCancel:(event:ConnectorOverlayPointerEvent)=>void;
 onLostPointerCapture:(event:ConnectorOverlayPointerEvent)=>void;
}

export function BoardConnectorHandles({viewport,path,relationship,color,canEdit,active,snapCandidate,onPointerDown,onPointerMove,onPointerUp,onPointerCancel,onLostPointerCapture}:BoardConnectorHandlesProps){
 const id=useId().replace(/:/g,'');
 const screen=(point:{x:number;y:number})=>({x:viewport.panX+point.x*viewport.zoom,y:viewport.panY+point.y*viewport.zoom});
 const events={onPointerMove,onPointerUp,onPointerCancel,onLostPointerCapture};
 const occupied:Array<{x:number;y:number}>=[];
 const leaders:Array<{id:string;from:{x:number;y:number};to:{x:number;y:number}}>=[];
 const handle=(kind:ConnectorHandleKind,point:{x:number;y:number},name:string,handleId:string|null=null)=>{
  const origin=screen(point);
  let position=origin;
  if(kind==='route'||kind==='label'){
   const overlaps=(candidate:{x:number;y:number})=>occupied.some(other=>Math.abs(candidate.x-other.x)<48&&Math.abs(candidate.y-other.y)<48);
   for(let ring=1;overlaps(position)&&ring<=occupied.length+1;ring++){
    const distance=ring*48;
    const candidates=[[0,-distance],[distance,0],[0,distance],[-distance,0],[distance,-distance],[-distance,-distance],[distance,distance],[-distance,distance]].map(([x,y])=>({x:origin.x+x!,y:origin.y+y!}));
    const available=candidates.find(candidate=>candidate.x>=22&&candidate.y>=22&&!overlaps(candidate));
    if(available){position=available;break;}
   }
  }
  occupied.push(position);
  if(position!==origin)leaders.push({id:handleId??kind,from:origin,to:position});
  return <button key={`${kind}:${handleId??''}`} type="button" data-testid={`board-connector-handle-${handleId??kind}`} data-handle-kind={kind} aria-label={name} title={name} className="pointer-events-auto absolute grid h-[45px] w-[45px] touch-none place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{left:position.x,top:position.y,transform:'translate(-50%, -50%)'}} onPointerDown={event=>onPointerDown(kind,handleId,event)} {...events}><span aria-hidden="true" className={kind==='label'?'h-3 w-3 rotate-45 border-2 border-primary bg-background':'h-3 w-3 rounded-full border-2 border-primary bg-background'}/></button>;
 };
 const handles=path&&relationship&&canEdit&&!active?[
  handle('from',path.start,'调整连接起点'),handle('to',path.end,'调整连接终点'),
  ...connectorPathHandles(path).map(item=>handle('route',item.point,item.kind==='free'?'调整自由箭头节点':item.kind==='curve'?'调整曲线控制点':'调整折线路径',item.id)),
  ...(relationship.label.trim()?[handle('label',connectorLabelPlacement(path,relationship.labelPosition).point,'移动连接标签')]:[]),
 ]:[];
 const width=relationship?.strokeWidth??WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth;
 const tip=(style:ConnectorRelationship['startStyle'])=>style==='circle'?<circle cx="4" cy="4" r="4"/>:style==='diamond'?<path d="M 4 0 L 8 4 L 4 8 L 0 4 Z"/>:style==='arrow'?<path d="M 0 0 L 8 4 L 0 8 Z"/>:null;
 return <div data-testid="board-connector-handles" className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
  {path&&<svg data-testid="board-connector-overlay-path" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
   {leaders.map(leader=><line key={leader.id} data-testid={`board-connector-handle-leader-${leader.id}`} x1={leader.from.x} y1={leader.from.y} x2={leader.to.x} y2={leader.to.y} stroke={color} strokeWidth="1" strokeDasharray="3 3"/>)}
   <defs>{(['start','end'] as const).map(end=>{const style=end==='start'?relationship?.startStyle:relationship?.endStyle;return style&&style!=='none'?<marker key={end} id={`${id}-${end}`} markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse" fill={color}>{tip(style)}</marker>:null;})}</defs>
   <g transform={`translate(${viewport.panX} ${viewport.panY}) scale(${viewport.zoom})`}>
    {active&&<path data-testid="board-connector-live-path" d={connectorPathToSvg(path)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={relationship?.lineStyle==='dashed'?'10 7':relationship?.lineStyle==='dotted'?'2 6':undefined} markerStart={relationship?.startStyle&&relationship.startStyle!=='none'?`url(#${id}-start)`:undefined} markerEnd={relationship?.endStyle&&relationship.endStyle!=='none'?`url(#${id}-end)`:undefined}/>}
    {canEdit&&!active&&relationship?.fromPoint&&relationship.toPoint&&<path data-testid="board-connector-body-hit" d={connectorPathToSvg(path)} fill="none" stroke="transparent" strokeWidth={Math.max(12,width*viewport.zoom)} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" style={{pointerEvents:'stroke',touchAction:'none'}} onPointerDown={event=>onPointerDown('translate',null,event)} {...events}/>}
   </g>
  </svg>}
  {snapCandidate&&(()=>{const {geometry}=snapCandidate,position=screen(scenePointFromLocal(geometry,{x:geometry.width/2,y:geometry.height/2}));return <div data-testid="board-connector-snap-cue" data-target-id={snapCandidate.id} className="absolute border-2 border-primary bg-primary/10" style={{left:position.x,top:position.y,width:geometry.width*viewport.zoom,height:geometry.height*viewport.zoom,transform:`translate(-50%, -50%) rotate(${geometry.rotation}deg)`}}/>;})()}
  {handles}
 </div>;
}
