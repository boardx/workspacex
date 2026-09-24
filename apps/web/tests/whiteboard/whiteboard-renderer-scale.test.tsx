import { performance } from 'node:perf_hooks';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { WhiteboardObject } from '@repo/whiteboard-core';
import { WhiteboardRenderer } from '@/components/whiteboard/whiteboard-renderer';

const OBJECT_COUNT = 10_000;
const MAX_RENDERED_OBJECTS = 100;
const MAX_INITIAL_RENDER_MS = 5_000;

function sticky(index: number): WhiteboardObject {
  return {
    id: `scale-${index}`,
    schemaVersion: 1,
    kind: 'sticky',
    geometry: {
      x: (index % 100) * 300,
      y: Math.floor(index / 100) * 220,
      width: 180,
      height: 140,
      rotation: 0,
    },
    text: `便签 ${index}`,
    style: {},
    parentId: null,
    orderKey: String(index).padStart(5, '0'),
  };
}

function renderedObjects(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="board-object-"]'));
}

it('keeps a 10,000-object board bounded to the viewport while retaining selection', () => {
  const objects = Array.from({ length: OBJECT_COUNT }, (_, index) => sticky(index));
  const selectedId = 'scale-9999';
  const startedAt = performance.now();
  const view = render(
    <WhiteboardRenderer
      objects={objects}
      selected={[selectedId]}
      viewport={{ x: 0, y: 0, width: 1280, height: 720 }}
      onPointerDown={vi.fn()}
    />,
  );
  const initialRenderMs = performance.now() - startedAt;
  const initial = renderedObjects(view.container);

  expect(initial.length).toBeLessThan(MAX_RENDERED_OBJECTS);
  expect(view.getByTestId(`board-object-${selectedId}`)).toHaveAttribute('aria-pressed', 'true');
  expect(view.queryByTestId('board-object-scale-5050')).not.toBeInTheDocument();
  expect(initialRenderMs).toBeLessThan(MAX_INITIAL_RENDER_MS);

  view.rerender(
    <WhiteboardRenderer
      objects={objects}
      selected={[]}
      viewport={{ x: 14_000, y: 10_000, width: 1280, height: 720 }}
      onPointerDown={vi.fn()}
    />,
  );
  const moved = renderedObjects(view.container);

  expect(moved.length).toBeLessThan(MAX_RENDERED_OBJECTS);
  expect(view.queryByTestId('board-object-scale-0')).not.toBeInTheDocument();
  expect(moved.some(node => node.dataset.testid === 'board-object-scale-0')).toBe(false);
  expect(moved.length).toBeGreaterThan(0);
});
