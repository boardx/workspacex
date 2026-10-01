import { expect, it } from 'vitest';
import { stickyViewport } from '@/components/board-workspace-preview/sticky-viewport';
it('keeps a low created note above the measured expanded dock', () => {
  const view = stickyViewport({ left: 40, top: 530, width: 180, height: 160 }, { left: 12, top: 278, width: 351, height: 291 }, [1, 0, 0, 1, 0, 0]);
  expect(view[0]).toBe(1); expect(530 + view[5] + 160).toBe(569);
});
it('shrinks long paper to fit between measured context and dock without clipping', () => {
  const paper = { left: 300, top: 40, width: 180, height: 600 };
  const safe = { left: 12, top: 278, width: 351, height: 291 };
  const view = stickyViewport(paper, safe, [1, 0, 0, 1, 0, 0]);
  expect(view[0]).toBe(291 / 600);
  expect(paper.top * view[0] + view[5]).toBe(safe.top);
  expect((paper.top + paper.height) * view[0] + view[5]).toBe(safe.top + safe.height);
});
