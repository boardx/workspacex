import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {resolveConnectorPath,type ConnectorRelationship} from '@repo/whiteboard-core';
import {BoardConnectorHandles} from '@/components/whiteboard/board-connector-handles';
afterEach(cleanup);
const relationship:ConnectorRelationship={fromPoint:{x:10,y:20},toPoint:{x:110,y:120},fromAnchor:'right',toAnchor:'left',type:'curve',startStyle:'none',endStyle:'arrow',lineStyle:'solid',label:'Label',semanticRelation:'',labelPosition:{t:0,normalOffset:5},route:{kind:'curve',startOffset:{x:30,y:0},endOffset:{x:-30,y:0}}};
const path=()=>resolveConnectorPath({start:relationship.fromPoint!,end:relationship.toPoint!,type:relationship.type,route:relationship.route});
const props=()=>({viewport:{panX:7,panY:9,zoom:2,fitRequest:0},path:path(),relationship,color:'#123456',canEdit:true,active:false,onPointerDown:vi.fn(),onPointerMove:vi.fn(),onPointerUp:vi.fn(),onPointerCancel:vi.fn(),onLostPointerCapture:vi.fn()});
it('projects shared endpoints, route controls and arc label with fixed screen hit dimensions',()=>{
 render(<BoardConnectorHandles {...props()}/>);
 const start=screen.getByTestId('board-connector-handle-from');expect(start).toHaveStyle({left:'27px',top:'49px'});expect(start).toHaveClass('h-[45px]','w-[45px]');
 expect(screen.getByTestId('board-connector-handle-curve-start')).toHaveStyle({left:'87px',top:'49px'});
 expect(screen.getByTestId('board-connector-handle-label')).toHaveStyle({left:'27px',top:'107px'});
 expect(screen.getByTestId('board-connector-handle-leader-label')).toHaveAttribute('x1','27');
 expect(screen.getByTestId('board-connector-handle-leader-label')).toHaveAttribute('y1','59');
 expect(screen.queryByTestId('board-connector-live-path')).toBeNull();
});
it('forwards capture lifecycle to state owner and free body uses actual path hit rather than bounds',()=>{
 const value=props();render(<BoardConnectorHandles {...value}/>);
 const handle=screen.getByTestId('board-connector-handle-curve-start');fireEvent.pointerDown(handle,{pointerId:1});expect(value.onPointerDown).toHaveBeenCalledWith('route','curve-start',expect.anything());
 fireEvent.pointerMove(handle);fireEvent.pointerUp(handle);fireEvent.pointerCancel(handle);fireEvent.lostPointerCapture(handle);
 for(const callback of [value.onPointerMove,value.onPointerUp,value.onPointerCancel,value.onLostPointerCapture])expect(callback).toHaveBeenCalledOnce();
 const body=screen.getByTestId('board-connector-body-hit');expect(body.tagName.toLowerCase()).toBe('path');expect(body).toHaveStyle({pointerEvents:'stroke'});expect(body).toHaveAttribute('vector-effect','non-scaling-stroke');fireEvent.pointerDown(body);expect(value.onPointerDown).toHaveBeenLastCalledWith('translate',null,expect.anything());
});
it('does not expose write handles for readonly but keeps controlled live preview and rotated snap cue',()=>{
 const value=props();render(<BoardConnectorHandles {...value} canEdit={false} active snapCandidate={{id:'target',geometry:{x:20,y:30,width:100,height:50,rotation:30}}}/>);
 expect(screen.queryAllByRole('button')).toHaveLength(0);expect(screen.queryByTestId('board-connector-body-hit')).toBeNull();expect(screen.getByTestId('board-connector-live-path')).toHaveAttribute('stroke','#123456');
 const cue=screen.getByTestId('board-connector-snap-cue');
 expect(Number.parseFloat(cue.style.left)).toBeCloseTo(7+2*(20+50*Math.cos(Math.PI/6)-25*Math.sin(Math.PI/6)),4);
 expect(Number.parseFloat(cue.style.top)).toBeCloseTo(9+2*(30+50*Math.sin(Math.PI/6)+25*Math.cos(Math.PI/6)),4);
 expect(cue).toHaveStyle({width:'200px',height:'100px',transform:'translate(-50%, -50%) rotate(30deg)'});expect(value.onPointerDown).not.toHaveBeenCalled();
});
it('attached straight edges have only endpoint handles and no free translation target',()=>{
 const value=props(),attached={...relationship,from:'a',to:'b',fromPoint:undefined,toPoint:undefined,type:'straight' as const,route:undefined,label:''};
 render(<BoardConnectorHandles {...value} relationship={attached} path={resolveConnectorPath({start:{x:10,y:20},end:{x:110,y:120}})}/>);
 expect(screen.getAllByRole('button')).toHaveLength(2);expect(screen.queryByTestId('board-connector-body-hit')).toBeNull();expect(screen.queryByTestId('board-connector-handle-label')).toBeNull();
});
