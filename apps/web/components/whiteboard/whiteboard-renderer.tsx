'use client';
import type { PointerEvent } from 'react';
import { selectVisibleObjects, type WhiteboardObject, type WhiteboardViewport } from '@repo/whiteboard-core';
import { cn } from '@/lib/utils';
export function WhiteboardRenderer({ objects, selected, viewport, onPointerDown }: { objects: WhiteboardObject[]; selected: string[]; viewport: WhiteboardViewport; onPointerDown: (event: PointerEvent, id: string) => void }) {
  const byId = new Map(objects.map(object => [object.id, object]));
  const rendered = selectVisibleObjects(objects, viewport, new Set(selected));
  return <>{[...rendered].sort((a, b) => Number(['frame','group'].includes(b.kind)) - Number(['frame','group'].includes(a.kind))).map(o => {
    const g = o.geometry;
    if (o.kind === 'connector') {
      const a = o.connector ? byId.get(o.connector.from) : undefined, b = o.connector ? byId.get(o.connector.to) : undefined;
      if (!a || !b) return null;
      return <svg key={o.id} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-label="连接线"><line x1={a.geometry.x + a.geometry.width / 2} y1={a.geometry.y + a.geometry.height / 2} x2={b.geometry.x + b.geometry.width / 2} y2={b.geometry.y + b.geometry.height / 2} stroke="currentColor" strokeWidth="2" /></svg>;
    }
    const points = o.kind === 'drawing' && Array.isArray(o.extensionData?.points) ? o.extensionData.points.filter((p): p is number[] => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && Number.isFinite(v))).map(p => p.join(',')).join(' ') : '';
    return <button key={o.id} data-testid={`board-object-${o.id}`} data-parent-id={o.parentId ?? ''} aria-label={`图形：${o.text || o.kind}`} aria-pressed={selected.includes(o.id)} onPointerDown={e => onPointerDown(e, o.id)} className={cn('absolute whitespace-pre-wrap break-words rounded-control border border-border p-4 text-left text-16 focus-visible:ring-2 focus-visible:ring-ring', o.kind === 'sticky' ? 'bg-warning-tint text-warning-tint-foreground shadow-sm' : 'bg-card text-card-foreground', ['frame','group','drawing','text'].includes(o.kind) && 'bg-transparent', ['frame','group'].includes(o.kind) && 'border-dashed', o.kind === 'ellipse' && 'rounded-full', selected.includes(o.id) && 'ring-2 ring-ring')} style={{ left: g.x, top: g.y, width: g.width, height: g.height, transform: `rotate(${g.rotation}deg)`, backgroundColor: o.style.fill, color: o.style.color, borderColor: o.style.stroke, fontSize: o.style.fontSize }}>
      {o.kind === 'drawing' ? <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${g.width} ${g.height}`}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" /></svg> : o.text || (o.kind === 'image' ? '图片对象' : o.kind === 'extension' ? '扩展对象' : '')}
    </button>;
  })}</>;
}
