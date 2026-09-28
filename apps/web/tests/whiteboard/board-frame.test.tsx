import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {boardFrameCenter,followBoardFrame,useBoardFrame} from '@/components/whiteboard/use-board-frame';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('measures editor height as a wrapping banner grows without a window resize',()=>{
 let height=744,notify=()=>{};vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({width:1200,height}) as DOMRect);
 vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){notify=callback;}observe(){}disconnect(){}});
 function Probe(){const frame=useBoardFrame();return <section ref={frame.ref}><output data-testid="frame">{frame.size.width}x{frame.size.height}</output></section>;}
 render(<Probe/>);expect(screen.getByTestId('frame')).toHaveTextContent('1200x744');
 height=680;act(()=>notify());expect(screen.getByTestId('frame')).toHaveTextContent('1200x680');
});
it('quick creation and presence use the actual canvas center below different banner heights',()=>{
 const viewport={panX:20,panY:40,zoom:2};
 expect(boardFrameCenter({width:1200,height:744},viewport)).toEqual({x:290,y:166});
 expect(boardFrameCenter({width:1200,height:680},viewport)).toEqual({x:290,y:150});
});
it('followers with different frame sizes retain the presenter world center including local resize',()=>{
 const presenter=boardFrameCenter({width:1200,height:744},{panX:20,panY:40,zoom:2});
 const remote={centerX:presenter.x,centerY:presenter.y,zoom:2};
 for(const height of [680,612]){
  const frame={width:960,height},follow=followBoardFrame(frame,remote);
  expect(boardFrameCenter(frame,follow)).toEqual(presenter);
 }
});
