import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {STICKY_COLOR_PRESETS,type WhiteboardObject} from '@repo/whiteboard-core';
import {ObjectContextToolbar} from '@/components/whiteboard/object-context-toolbar';
import {toBoardFabricObjects} from '@/components/whiteboard/whiteboard-fabric-projection';

afterEach(cleanup);
const base:WhiteboardObject={id:'legacy',schemaVersion:1,kind:'sticky',geometry:{x:20,y:80,width:180,height:180,rotation:0},text:'Legacy note',style:{fill:STICKY_COLOR_PRESETS.blue},parentId:null,orderKey:'a'};
function mount(object:WhiteboardObject,readOnly=false){
 const mutations={onStickyChange:vi.fn(),onTextChange:vi.fn(),onExperienceChange:vi.fn(),onGeometryChange:vi.fn()};
 render(<ObjectContextToolbar object={object} readOnly={readOnly} actorId="viewer" {...mutations} onClose={vi.fn()} onFutureAction={vi.fn()}/>);
 return mutations;
}
function expectPaperMatch(object:WhiteboardObject){
 const paper=toBoardFabricObjects([object])[0]!;
 expect(screen.getByTestId('board-sticky-style-open').querySelector('span')).toHaveStyle({backgroundColor:paper.style.fill});
 return paper;
}
it('uses the actual legacy paper fill instead of inventing yellow metadata on selection',()=>{
 const before=JSON.stringify(base),mutations=mount(base);
 expectPaperMatch(base);
 fireEvent.click(screen.getByTestId('board-sticky-style-open'));
 expect(screen.getByTestId('sticky-quick-color-blue')).toHaveAttribute('aria-pressed','true');
 expect(JSON.stringify(base)).toBe(before);
 for(const callback of Object.values(mutations))expect(callback).not.toHaveBeenCalled();
});
it.each(Object.entries(STICKY_COLOR_PRESETS).flatMap(([name,color])=>['square','rectangle','circle'].map(variant=>({name,color,variant}))))('keeps metadata $name/$variant consistent with renderer despite stale legacy fill',({color,variant})=>{
 const object={...base,extensionData:{thinkingInput:{sticky:{color,variant,sizing:'fixed'}}}};
 mount(object);expectPaperMatch(object);
 fireEvent.click(screen.getByTestId('board-sticky-style-open'));
 const preset=screen.queryByTestId(`sticky-quick-color-${Object.entries(STICKY_COLOR_PRESETS).find(([,value])=>value===color)![0]}`);
 if(preset)expect(preset).toHaveAttribute('aria-pressed','true');
});
it.each(['#123ABC','#93c5fd'])('uses a legacy custom fill %s without writing in readonly mode',(fill)=>{
 const object={...base,style:{fill}},before=JSON.stringify(object),mutations=mount(object,true);
 expectPaperMatch(object);fireEvent.click(screen.getByTestId('board-sticky-style-open'));
 for(const button of screen.getByRole('group',{name:'便利贴颜色'}).querySelectorAll('button'))expect(button).toBeDisabled();
 expect(JSON.stringify(object)).toBe(before);for(const callback of Object.values(mutations))expect(callback).not.toHaveBeenCalled();
});
it('falls back exactly as renderer does when Sticky metadata is invalid',()=>{
 const object={...base,extensionData:{thinkingInput:{sticky:{color:'url(unsafe)',variant:'triangle',sizing:'bad'}}}};
 mount(object);expectPaperMatch(object);
});
