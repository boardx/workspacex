import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ handlers: {} as Record<string, (event: unknown) => void> }));
vi.mock('fabric', () => {
  class Textbox {}
  return { Textbox, Rect: class {}, Circle: class {}, Line: class {}, PencilBrush: class {}, Canvas: class {
    width = 900; height = 700; viewportTransform = [1, 0, 0, 1, 0, 0]; objects: unknown[] = []; active: unknown;
    constructor(element: HTMLCanvasElement) {
      // Reproduce Fabric's ownership change: React's canvas is no longer a direct child.
      const wrapper = document.createElement('div'); wrapper.dataset.fabricWrapper = 'true';
      element.parentNode!.insertBefore(wrapper, element); wrapper.append(element);
    }
    on(name: string, callback: (event: unknown) => void) { state.handlers[name] = callback; }
    getObjects() { return this.objects; }
    setDimensions() {} setViewportTransform(value: number[]) { this.viewportTransform = value; }
    requestRenderAll() {} getZoom() { return 1; }
    add(object: unknown) { this.objects.push(object); }
    setActiveObject(object: unknown) { this.active = object; state.handlers['selection:created']?.({}); }
    getActiveObject() { return this.active; } discardActiveObject() { this.active = null; state.handlers['selection:cleared']?.({}); }
    getScenePoint() { return { x: 200, y: 250 }; }
    toJSON() { return {}; } async dispose() {}
  } };
});
vi.mock('@/components/board-workspace-preview/sticky', () => {
  class PreviewSticky {
    left = 200; top = 250; width = 180; height = 160; backgroundColor = '#fff1a8'; fontSize = 22; textAlign = 'center';
    getBoundingRect() { return { left: this.left, top: this.top, width: this.width, height: this.height }; }
    enterEditing() {} exitEditing() {} selectAll() {} set() {} initDimensions() {} setCoords() {}
  }
  return { PreviewSticky, makeSticky: () => new PreviewSticky(), adjacentSticky: () => new PreviewSticky(), stickyTextColor: () => '#292929' };
});
import { WorkspaceCanvas } from '@/components/board-workspace-preview/canvas';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); state.handlers = {}; });
it('mounts and removes selected controls safely after Fabric reparents its canvas', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const options = { tool: 'select' as const, color: '#fff1a8', shape: 'rect', width: 2, readonly: false };
  const view = render(<WorkspaceCanvas options={options} seeded={false} onDraft={() => {}} />);
  expect(screen.queryByTestId('sticky-context-controls')).toBeNull();
  act(() => state.handlers['mouse:dblclick']?.({ e: new MouseEvent('dblclick') }));
  expect(screen.getByTestId('sticky-context-controls')).toBeTruthy();
  expect(screen.getByTestId('fabric-dom-host').querySelector('[data-fabric-wrapper] canvas')).toBeTruthy();
  view.rerender(<WorkspaceCanvas options={{ ...options, readonly: true }} seeded={false} onDraft={() => {}} />);
  expect(screen.queryByTestId('sticky-context-controls')).toBeNull();
});
