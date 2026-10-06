import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ShapeToolPreview } from '../../components/whiteboard/board-tool-preview';

afterEach(cleanup);

describe('R04 native shape selectors use actual preview DOM', () => {
  const cases = [
    ['rectangle', 'rect'], ['rounded-rectangle', 'rect'], ['circle', 'circle'],
    ['ellipse', 'ellipse'], ['diamond', 'path'], ['triangle', 'path'],
    ['hexagon', 'path'], ['cloud', 'path'], ['database', 'ellipse'],
    ['document', 'path'], ['process', 'rect'], ['decision', 'path'],
    ['terminator', 'rect'], ['data', 'path'], ['predefined-process', 'rect'],
  ] as const;

  for (const [variant, tag] of cases) {
    it(`${variant} has real ${tag} geometry`, () => {
      const { container } = render(<ShapeToolPreview variant={variant} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('fill')).toBe('none');
      expect(svg?.querySelector(tag)).not.toBeNull();
      expect(svg?.querySelectorAll('path,rect,ellipse,circle').length).toBeGreaterThan(0);
    });
  }

  it('rejects the obsolete selector that omitted Circle', () => {
    const { container } = render(<ShapeToolPreview variant="circle" />);
    expect(container.querySelectorAll('svg path,svg rect,svg ellipse')).toHaveLength(0);
    expect(container.querySelectorAll('svg circle')).toHaveLength(1);
  });
});
