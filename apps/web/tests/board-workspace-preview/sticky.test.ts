import { describe, expect, it } from 'vitest';
import { getEnv } from 'fabric/node';
import { setEnv, StaticCanvas, util } from 'fabric';
setEnv(getEnv());
import { makeSticky, PreviewSticky } from '@/components/board-workspace-preview/sticky';
describe('preview sticky serialization', () => {
 it('deletes the complete paper and text as one canvas object', async () => {
  const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
  const sticky = makeSticky(40, 60, '#fff1a8', '同一个对象');
  canvas.add(sticky); expect(canvas.getObjects()).toHaveLength(1);
  canvas.remove(sticky); expect(canvas.getObjects()).toHaveLength(0);
  await canvas.dispose();
 });
 it('restores one editable sticky with complete paper and text colors', async () => {
  const sticky = makeSticky(40, 60, '#fff1a8', '保留这个想法');
  expect(sticky.width).toBe(180); expect(sticky.height).toBeGreaterThanOrEqual(160);
  const restored = await util.enlivenObjects<PreviewSticky>([sticky.toObject()]);
  expect(restored).toHaveLength(1);
  expect(restored[0]).toBeInstanceOf(PreviewSticky);
  expect(restored[0]?.text).toBe('保留这个想法');
  expect(restored[0]?.backgroundColor).toBe('#fff1a8');
  expect(restored[0]?.fill).toBe('#292929');
  expect(restored[0]?.width).toBe(180); expect(restored[0]?.height).toBeGreaterThanOrEqual(160);
 });
});

import { createPreviewSeedObjects } from '@/components/board-workspace-preview/seed';
it('copies an unopened fixture with complete independent serialized objects', async () => {
 const original = createPreviewSeedObjects();
 const copied = await util.enlivenObjects<PreviewSticky>(original.map(object => object.toObject()));
 expect(copied).toHaveLength(2); expect(copied[0]?.text).toBe(original[0]?.text);
 copied[0]?.set({ text: '副本独立编辑', backgroundColor: '#d4edd8' });
 expect(original[0]?.text).toBe('让每个想法\n都被看见'); expect(original[0]?.backgroundColor).toBe('#fff1a8');
});
