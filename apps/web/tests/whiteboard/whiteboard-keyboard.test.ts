import { describe, expect, it } from 'vitest';
import type { WhiteboardObject } from '@repo/whiteboard-core';
import { boardObjectLabel, nextBoardObject } from '@/lib/whiteboard-keyboard';

const object = (id: string, x: number, y: number, text = id): WhiteboardObject => ({
  id, schemaVersion: 1, kind: 'sticky', geometry: { x, y, width: 100, height: 80, rotation: 0 },
  text, style: {}, parentId: null, orderKey: id,
});

describe('whiteboard keyboard spatial navigation', () => {
  const objects = [object('center', 100, 100), object('right', 260, 110), object('down', 110, 280), object('diagonal', 230, 240)];
  it('enters at the top-left object and moves to the nearest aligned object', () => {
    expect(nextBoardObject(objects, null, 'ArrowRight')?.id).toBe('center');
    expect(nextBoardObject(objects, 'center', 'ArrowRight')?.id).toBe('right');
    expect(nextBoardObject(objects, 'center', 'ArrowDown')?.id).toBe('down');
  });
  it('stays on the active object when no object exists in that direction', () => {
    expect(nextBoardObject(objects, 'center', 'ArrowLeft')?.id).toBe('center');
  });
  it('provides a stable type and text label', () => {
    expect(boardObjectLabel(object('idea', 0, 0, '客户反馈'))).toBe('便利贴“客户反馈”');
  });
});
