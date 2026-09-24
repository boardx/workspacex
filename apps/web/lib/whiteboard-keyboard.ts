import type { WhiteboardObject } from '@repo/whiteboard-core';

export type BoardDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

function center(object: WhiteboardObject) {
  return {
    x: object.geometry.x + object.geometry.width / 2,
    y: object.geometry.y + object.geometry.height / 2,
  };
}

/** Pick the nearest object in a direction while preferring alignment on the secondary axis. */
export function nextBoardObject(
  objects: readonly WhiteboardObject[],
  activeId: string | null,
  direction: BoardDirection,
): WhiteboardObject | undefined {
  const candidates = objects.filter(object => object.kind !== 'connector');
  if (!candidates.length) return undefined;
  const active = candidates.find(object => object.id === activeId);
  if (!active) return [...candidates].sort((a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x)[0];
  const origin = center(active);
  const scored = candidates.flatMap(object => {
    if (object.id === active.id) return [];
    const point = center(object), dx = point.x - origin.x, dy = point.y - origin.y;
    const forward = direction === 'ArrowRight' ? dx : direction === 'ArrowLeft' ? -dx : direction === 'ArrowDown' ? dy : -dy;
    if (forward <= 0) return [];
    const cross = direction === 'ArrowRight' || direction === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
    return [{ object, score: forward + cross * 2 }];
  });
  return scored.sort((a, b) => a.score - b.score || a.object.id.localeCompare(b.object.id))[0]?.object ?? active;
}

export function boardObjectLabel(object: WhiteboardObject | undefined) {
  if (!object) return '未命名对象';
  const kind = ({ sticky: '便利贴', text: '文字', rectangle: '矩形', ellipse: '椭圆', frame: 'Frame', group: '组', image: '图片', drawing: '绘图', extension: '扩展对象' } as const)[object.kind as Exclude<WhiteboardObject['kind'], 'connector'>] ?? '对象';
  return `${kind}“${object.text.trim() || '未命名'}”`;
}
