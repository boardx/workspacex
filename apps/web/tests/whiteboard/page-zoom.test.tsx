import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DisablePageZoom, allowsPageZoom } from '@/components/system/disable-page-zoom';
import { retainLiveBoardZoomScope } from '@/components/whiteboard/live-board';

afterEach(() => {
  cleanup();
  document.body.removeAttribute('data-live-board-page');
  delete document.documentElement.dataset.liveBoardMounted;
  window.history.replaceState({}, '', '/');
});

it('reference-counts concurrent and StrictMode-style Board scope lifetimes',()=>{
  const root=document.createElement('div');
  const releaseFirst=retainLiveBoardZoomScope(root),releaseSecond=retainLiveBoardZoomScope(root);
  expect(root.dataset.liveBoardMounted).toBe('true');
  releaseFirst();releaseFirst();expect(root.dataset.liveBoardMounted).toBe('true');
  releaseSecond();expect(root.dataset.liveBoardMounted).toBeUndefined();
  const releaseRemount=retainLiveBoardZoomScope(root);expect(root.dataset.liveBoardMounted).toBe('true');
  releaseRemount();expect(root.dataset.liveBoardMounted).toBeUndefined();
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
  document.documentElement.dataset.liveBoardMounted='true';
  const markerWheel=new WheelEvent('wheel',{ctrlKey:true,cancelable:true});
  window.dispatchEvent(markerWheel);
  expect(markerWheel.defaultPrevented).toBe(false);
  delete document.documentElement.dataset.liveBoardMounted;
  window.history.replaceState({}, '', '/projects');
  const restoredGuard=new WheelEvent('wheel',{ctrlKey:true,cancelable:true});
  window.dispatchEvent(restoredGuard);
  expect(restoredGuard.defaultPrevented).toBe(true);
  view.unmount();
});
