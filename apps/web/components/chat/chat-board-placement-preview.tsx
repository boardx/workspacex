'use client';
import * as React from 'react';
import type { WhiteboardGeometry } from '@repo/contracts/whiteboard-document';
import { Button } from '@/components/ui/button';
import { insertionPlacement } from '@/lib/board-insertion-placement';

export function ChatBoardPlacementPreview({ existing, incoming, offset, onChange, disabled }: {
  existing: WhiteboardGeometry[]; incoming: WhiteboardGeometry[]; offset: {x:number;y:number};
  onChange: (offset:{x:number;y:number})=>void; disabled:boolean;
}) {
  const {source,view,recommended} = React.useMemo(()=>insertionPlacement(existing,incoming),[existing,incoming]);
  const dragging = React.useRef(false);
  const choose = (event:React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    const matrix=event.currentTarget.getScreenCTM();
    if(!matrix)return;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    onChange({x:point.x-source.x-source.width/2,y:point.y-source.y-source.height/2});
  };
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">灰色为已有内容，色框为插入范围</span>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={()=>onChange(recommended)}>推荐空白位置</Button>
    </div>
    <svg data-testid="chat-board-placement-preview" role="application" aria-label="插入位置预览，点击或拖动选择位置，也可用方向键微调" aria-disabled={disabled}
      tabIndex={disabled?-1:0} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid meet"
      className="h-64 w-full touch-none cursor-crosshair rounded-lg border border-border bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={event=>{if(disabled)return;dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);choose(event);}}
      onPointerMove={event=>{if(dragging.current)choose(event);}}
      onPointerUp={()=>{dragging.current=false;}} onPointerCancel={()=>{dragging.current=false;}}
      onKeyDown={event=>{
        const delta = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
        if (!delta || disabled) return;
        event.preventDefault();const step=Math.min(view.width,view.height)/40*(event.shiftKey?5:1);
        onChange({x:offset.x+delta[0]!*step,y:offset.y+delta[1]!*step});
      }}>
      {existing.map((geometry,index)=><rect key={index} x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} transform={`rotate(${geometry.rotation} ${geometry.x} ${geometry.y})`} className="fill-muted stroke-muted-foreground/40" vectorEffect="non-scaling-stroke"/>)}
      <rect data-testid="chat-board-placement-range" x={source.x+offset.x} y={source.y+offset.y} width={source.width} height={source.height}
        className="fill-primary/15 stroke-primary" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke"/>
    </svg>
    <p className="text-sm text-muted-foreground">点击或拖动色框选择位置。仅显示内容轮廓，插入后保持画布原有布局。</p>
  </div>;
}
