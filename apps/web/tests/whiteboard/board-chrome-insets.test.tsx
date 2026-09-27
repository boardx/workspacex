import {renderHook,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useBoardChromeInsets} from '@/components/whiteboard/use-board-chrome-insets';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('reserves measured responsive rows and releases the multi-selection row when hidden',()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 const root=document.createElement('section');document.body.append(root);
 root.innerHTML='<header data-testid="board-editor-header"></header><div data-testid="board-navigation-controls"></div>';
 const rect=(x:number,y:number,width:number,height:number)=>({x,y,width,height,top:y,bottom:y+height,left:x,right:x+width,toJSON(){}});
 root.getBoundingClientRect=()=>rect(0,0,1024,900);
 root.children[0]!.getBoundingClientRect=()=>rect(0,0,1024,64);
 root.children[1]!.getBoundingClientRect=()=>rect(250,750,524,54);
 const host={current:root},hook=renderHook(({selected})=>useBoardChromeInsets(host,selected),{initialProps:{selected:0}});
 expect(hook.result.current).toMatchObject({top:80,bottom:162});
 const multi=document.createElement('div');multi.dataset.testid='board-selection-layout-toolbar';multi.getBoundingClientRect=()=>rect(350,688,300,52);root.append(multi);
 hook.rerender({selected:30});expect(hook.result.current.bottom).toBe(224);
 multi.remove();root.children[0]!.getBoundingClientRect=()=>rect(0,0,375,112);root.getBoundingClientRect=()=>rect(0,0,375,900);
 hook.rerender({selected:0});expect(hook.result.current).toMatchObject({top:128,bottom:162});root.remove();
});
