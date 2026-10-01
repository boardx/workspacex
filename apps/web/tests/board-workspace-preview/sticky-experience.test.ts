import { describe, expect, it, vi } from 'vitest';
import { getEnv } from 'fabric/node';
import { setEnv, util } from 'fabric';
setEnv(getEnv());
import { makeSticky, adjacentSticky, PreviewSticky } from '@/components/board-workspace-preview/sticky';
describe('rapid sticky authoring', () => {
  it('wraps text inside paper padding and grows for long CJK content', () => {
    const note = makeSticky(0, 0, '#fff1a8', '长文字内容测试'.repeat(30));
    expect(note.height).toBeGreaterThan(160);
    expect(note._getTopOffset()).toBe(-note.height / 2 + 16);
    note.set({ textAlign: 'left' });
    expect(note._getLineLeftOffset(0)).toBe(16);
    for (let line = 0; line < note.textLines.length; line++) expect(note.getLineWidth(line)).toBeLessThanOrEqual(note.width - 32);
  });
  it('creates adjacent note with inherited styles without copying source text', () => {
    const note = makeSticky(20, 40, '#d8e8ff', '原始内容'); note.set({ fontSize: 28, textAlign: 'left' });
    const next = adjacentSticky(note);
    expect(next.left).toBe(note.left + note.getScaledWidth() + 24);
    expect(next.backgroundColor).toBe(note.backgroundColor); expect(next.fontSize).toBe(28); expect(next.textAlign).toBe('left');
    expect(next.text).not.toBe(note.text); expect(adjacentSticky(note, true).text).toBe(note.text);
  });
  it('creates on Tab but never while composing or Shift+Tab navigating', () => {
    const note = makeSticky(0, 0, '#fff1a8'); note.onNextSticky = vi.fn();
    note.onKeyDown(new (getEnv().window.KeyboardEvent)('keydown', { key: 'Tab', isComposing: true }));
    note.onKeyDown(new (getEnv().window.KeyboardEvent)('keydown', { key: 'Tab', shiftKey: true }));
    expect(note.onNextSticky).not.toHaveBeenCalled();
    note.onKeyDown(new (getEnv().window.KeyboardEvent)('keydown', { key: 'Tab' })); expect(note.onNextSticky).toHaveBeenCalledOnce();
  });
  it('keeps dark paper readable after using drawing ink', () => { expect(makeSticky(0, 0, '#292929').fill).toBe('#ffffff'); });
  it('roundtrips text metrics without accumulating padding or serializing callbacks', async () => {
    const note = makeSticky(0, 0, '#fff1a8', '文字'.repeat(50)); const height = note.height;
    note.initDimensions(); expect(note.height).toBe(height);
    const [restored] = await util.enlivenObjects<PreviewSticky>([note.toObject()]);
    expect(restored?.height).toBe(height); expect(restored?.onNextSticky).toBeUndefined();
  });
});
