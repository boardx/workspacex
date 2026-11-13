'use client';
import * as React from 'react';
import type { WhiteboardGeometry } from '@repo/contracts/whiteboard-document';
import type { RenderedDiagramLayout, WhiteboardPlacementPreview } from '@repo/contracts/whiteboard-operation';
import { Button } from '@/components/ui/button';
import { renderedDiagramObjectKind } from '@repo/whiteboard-core';
import { insertionBounds, insertionPlacement } from '@/lib/board-insertion-placement';
import { BoardMinimapScene } from '@/components/whiteboard/board-minimap-scene';
import { minimapGeometry, MINIMAP_HEIGHT, MINIMAP_WIDTH, type MinimapObject } from '@/components/whiteboard/board-minimap-geometry';

export function ChatBoardPlacementPreview({ existing, incoming, incomingObjects = [], offset, onChange, disabled }: {
  existing: WhiteboardPlacementPreview['objects']; incoming: WhiteboardGeometry[];
  incomingObjects?: RenderedDiagramLayout['objects']; offset: {x:number;y:number};
  onChange: (offset:{x:number;y:number})=>void; disabled:boolean;
}) {
  const visible=React.useMemo(()=>existing.filter(object=>!object.appearance?.hidden),[existing]);
  const {source,view,recommended}=React.useMemo(()=>insertionPlacement(visible.map(object=>object.geometry),incoming),[visible,incoming]);
  const objects: MinimapObject[]=visible.map(object=>({id:object.id,geometry:object.geometry,kind:object.appearance?.kind??'rectangle',style:object.appearance?.style??{}}));
  const [settledOffset,setSettledOffset]=React.useState(offset);
  const [dragging,setDragging]=React.useState(false);
  React.useEffect(()=>{if(!dragging)setSettledOffset(offset);},[offset,dragging]);
  const expanded=insertionBounds([{...view,rotation:0},{...source,x:source.x+settledOffset.x,y:source.y+settledOffset.y,rotation:0}]);
  const padding=Math.max(expanded.width,expanded.height)*.05;
  const extent={x:expanded.x-padding,y:expanded.y-padding,width:expanded.width+padding*2,height:expanded.height+padding*2};
  // Moving the range must not rescale the thumbnail during a gesture.
  const map=minimapGeometry(objects,{zoom:1,panX:-extent.x,panY:-extent.y,fitRequest:0},{width:extent.width,height:extent.height});
  const drag=React.useRef<{id:number;start:{x:number;y:number};grab:{x:number;y:number}}|null>(null);
  const scenePoint=(event:React.PointerEvent<SVGSVGElement>)=>{
    const svg = event.currentTarget;
    const transform = svg.getScreenCTM?.();
    if (transform) {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
      return { x: (point.x - map.offsetX) / map.scale, y: (point.y - map.offsetY) / map.scale };
    }
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / MINIMAP_WIDTH, rect.height / MINIMAP_HEIGHT);
    if (!scale) return null;
    const x = (event.clientX - rect.left - (rect.width - MINIMAP_WIDTH * scale) / 2) / scale;
    const y = (event.clientY - rect.top - (rect.height - MINIMAP_HEIGHT * scale) / 2) / scale;
    return { x: (x - map.offsetX) / map.scale, y: (y - map.offsetY) / map.scale };
  };
  const choose=(event:React.PointerEvent<SVGSVGElement>)=>{
    if(disabled)return;const point=scenePoint(event);if(!point)return;
    onChange({x:point.x-source.x-source.width/2-(drag.current?.grab.x??0),y:point.y-source.y-source.height/2-(drag.current?.grab.y??0)});
  };
  const placed: MinimapObject[]=incomingObjects.map((object,index)=>({
    id:`incoming-${index}`,kind:renderedDiagramObjectKind(object),
    geometry:{...object.geometry,x:object.geometry.x+offset.x,y:object.geometry.y+offset.y},
    text: object.text,
    style:{...(typeof object.style.fill==='string'?{fill:object.style.fill}:{}),...(typeof object.style.stroke==='string'?{stroke:object.style.stroke}:{})},
  }));
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">红框内为待插入内容</span>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={()=>onChange(recommended)}>推荐空白位置</Button>
    </div>
    <BoardMinimapScene objects={[...objects,...placed]} map={map} wireframe preserveAspectRatio="xMidYMid meet" data-testid="chat-board-placement-preview" role="application"
      aria-label="插入位置预览，点击或拖动红框选择位置，也可用方向键微调" aria-disabled={disabled} tabIndex={disabled?-1:0}
      className="h-64 w-full touch-none cursor-crosshair rounded-lg border border-border bg-panel-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={event=>{
        if(disabled||event.button!==0)return;
        const point=scenePoint(event);if(!point)return;event.preventDefault();
        const x=source.x+offset.x,y=source.y+offset.y;
        const inside=point.x>=x&&point.x<=x+source.width&&point.y>=y&&point.y<=y+source.height;
        setDragging(true);drag.current={id:event.pointerId,start:offset,grab:inside?{x:point.x-x-source.width/2,y:point.y-y-source.height/2}:{x:0,y:0}};
        event.currentTarget.setPointerCapture?.(event.pointerId);choose(event);
      }}
      onPointerMove={event=>{if(drag.current?.id===event.pointerId)choose(event);}}
      onPointerUp={event=>{if(drag.current?.id!==event.pointerId)return;drag.current=null;setDragging(false);event.currentTarget.releasePointerCapture?.(event.pointerId);}}
      onPointerCancel={()=>{if(drag.current)onChange(drag.current.start);drag.current=null;setDragging(false);}}
      onLostPointerCapture={()=>{drag.current=null;setDragging(false);}}
      onKeyDown={event=>{
        const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
        if(!delta||disabled)return;event.preventDefault();
        const step=Math.min(view.width,view.height)/40*(event.shiftKey?5:1);
        onChange({x:offset.x+delta[0]!*step,y:offset.y+delta[1]!*step});
      }}>
      <rect data-testid="chat-board-placement-range" x={(source.x+offset.x)*map.scale+map.offsetX} y={(source.y+offset.y)*map.scale+map.offsetY}
        width={source.width*map.scale} height={source.height*map.scale} className="fill-destructive/10 stroke-destructive"
        strokeWidth="2" vectorEffect="non-scaling-stroke"/>
    </BoardMinimapScene>
    <p className="text-sm text-muted-foreground">拖动红框调整位置，确认后按原尺寸插入所选白板。取消不会修改白板。</p>
  </div>;
}
