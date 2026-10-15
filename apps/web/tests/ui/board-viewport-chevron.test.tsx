import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BoardViewportControls} from '@/components/whiteboard/board-viewport-controls';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const mount=()=>render(<BoardViewportControls zoom={1} onZoom={vi.fn()} onFitBoard={vi.fn()} onFitSelection={vi.fn()} hasSelection={false}/>);
async function open(){
 fireEvent.keyDown(screen.getByTestId('board-zoom-menu'),{key:'Enter'});
 return screen.findByTestId('board-zoom-content');
}
it('follows the actual portalled Radix side across bottom/top flips, without enlarging the 8px cue',async()=>{
 mount();const content=await open();
 // jsdom has no collision layout: change only Radix's placement output to
 // exercise the observer. Real 390px collision placement remains browser coverage.
 for(const [side,direction] of [['bottom','below'],['top','above'],['bottom','below']] as const){
  await act(async()=>{content.setAttribute('data-side',side);});
  // Lucide changes the SVG component type when direction changes, so the
  // old SVG is detached. Always assert the current rendered cue.
  await waitFor(()=>expect(screen.getByTestId('board-zoom-submenu-chevron')).toHaveAttribute('data-direction',direction));
  const cue=screen.getByTestId('board-zoom-submenu-chevron');
  expect(cue).toHaveAttribute('data-state','open');expect(cue).toHaveStyle({width:'8px',height:'8px'});
 }
});
it('disconnects the old content after close and observes the newly mounted portal on reopen',async()=>{
 mount();const oldContent=await open();
 await act(async()=>{oldContent.setAttribute('data-side','bottom');});
 await waitFor(()=>expect(screen.getByTestId('board-zoom-submenu-chevron')).toHaveAttribute('data-direction','below'));
 fireEvent.keyDown(oldContent,{key:'Escape'});
 await waitFor(()=>expect(screen.queryByTestId('board-zoom-content')).toBeNull());
 await act(async()=>{oldContent.setAttribute('data-side','left');});
 expect(screen.getByTestId('board-zoom-submenu-chevron')).toHaveAttribute('data-state','closed');
 expect(screen.getByTestId('board-zoom-submenu-chevron')).toHaveAttribute('data-direction','below');
 const newContent=await open();expect(newContent).not.toBe(oldContent);
 await act(async()=>{newContent.setAttribute('data-side','top');});
 await waitFor(()=>expect(screen.getByTestId('board-zoom-submenu-chevron')).toHaveAttribute('data-direction','above'));
});
