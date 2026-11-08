import * as React from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ChatBoardPlacementPreview} from '@/components/chat/chat-board-placement-preview';
afterEach(cleanup);
const incoming=[{x:100,y:100,width:100,height:50,rotation:0}];
it('drags a red frame in the shared minimap and cancellation restores its original placement',()=>{
 const changed=vi.fn();
 function Harness(){const[offset,setOffset]=React.useState({x:-100,y:-100});return <ChatBoardPlacementPreview existing={[]} incoming={incoming} offset={offset} onChange={value=>{changed(value);setOffset(value);}} disabled={false}/>;}
 render(<Harness/>);
 const svg=screen.getByTestId('chat-board-placement-preview');
 vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:240,height:160} as DOMRect);
 fireEvent.pointerDown(svg,{button:2,pointerId:1,clientX:120,clientY:80});expect(changed).not.toHaveBeenCalled();
 fireEvent.pointerDown(svg,{button:0,pointerId:2,clientX:120,clientY:80});
 fireEvent.pointerMove(svg,{pointerId:99,clientX:130,clientY:80});const before=changed.mock.calls.length;
 fireEvent.pointerMove(svg,{pointerId:2,clientX:130,clientY:80});expect(changed.mock.calls.length).toBeGreaterThan(before);
 expect(changed.mock.lastCall![0].x).toBeGreaterThan(-100);expect(changed.mock.lastCall![0].y).toBeCloseTo(-100);
 fireEvent.pointerCancel(svg,{pointerId:2});expect(changed).toHaveBeenLastCalledWith({x:-100,y:-100});
 const count=changed.mock.calls.length;fireEvent.pointerMove(svg,{pointerId:2,clientX:140,clientY:80});expect(changed).toHaveBeenCalledTimes(count);
});
it('uses canonical appearance for existing objects and includes incoming content inside the red frame',()=>{
 render(<ChatBoardPlacementPreview existing={[{id:'existing',geometry:{x:0,y:0,width:100,height:100,rotation:0},appearance:{kind:'ellipse',style:{fill:'#ffaa00'}}}]} incoming={incoming}
  incomingObjects={[{sourceId:'new',kind:'node',geometry:incoming[0]!,text:'new content',style:{fill:'#ffffff'},fromSourceId:null,toSourceId:null}]} offset={{x:100,y:0}} onChange={vi.fn()} disabled={false}/>);
 const svg=screen.getByTestId('chat-board-placement-preview');
 expect(svg.querySelector('rect[fill="#ffaa00"]')).not.toBeNull();expect(svg.querySelector('rect[fill="#ffffff"]')).not.toBeNull();
 expect(svg.lastElementChild).toBe(screen.getByTestId('chat-board-placement-range'));
});
