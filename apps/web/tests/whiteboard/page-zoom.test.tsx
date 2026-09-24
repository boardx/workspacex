import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DisablePageZoom, allowsPageZoom } from '@/components/system/disable-page-zoom';

afterEach(() => {
  cleanup();
  document.body.removeAttribute('data-live-board-page');
  window.history.replaceState({}, '', '/');
});

it('keeps the global zoom guard off the live Board route only', () => {
  expect(allowsPageZoom('/studio/board/board-123',true)).toBe(true);
  expect(allowsPageZoom('/studio/board/board-123',false)).toBe(false);
  expect(allowsPageZoom('/studio/board',true)).toBe(false);
  expect(allowsPageZoom('/projects',true)).toBe(false);

  window.history.replaceState({}, '', '/projects');
  const view=render(<DisablePageZoom/>);
  const guarded=new WheelEvent('wheel',{ctrlKey:true,cancelable:true});
  window.dispatchEvent(guarded);
  expect(guarded.defaultPrevented).toBe(true);

  window.history.replaceState({}, '', '/studio/board/board-123');
  document.body.setAttribute('data-live-board-page','');
  const boardWheel=new WheelEvent('wheel',{ctrlKey:true,cancelable:true});
  window.dispatchEvent(boardWheel);
  expect(boardWheel.defaultPrevented).toBe(false);
  const boardGesture=new Event('gesturestart',{cancelable:true});
  window.dispatchEvent(boardGesture);
  expect(boardGesture.defaultPrevented).toBe(false);
  document.body.removeAttribute('data-live-board-page');
  view.unmount();
});
