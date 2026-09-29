// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {Canvas} from 'fabric';
import {finishCancelledFabricTouch} from '@/components/whiteboard/fabric/fabric-input';
it('runs actual Fabric touch teardown: releases primary ID/document move and restores mouse listener',()=>{
 vi.useFakeTimers();const element=document.createElement('canvas'),move=vi.fn(),down=vi.fn();document.body.append(element);
 const state={mainTouchId:7,_currentTransform:{} as unknown,_cacheTransformEventData:vi.fn(),_resetTransformEventData:vi.fn(),__onMouseUp:vi.fn(()=>expect(state._currentTransform).toBeNull()),_getEventPrefix:()=> 'mouse',upperCanvasEl:element,_onTouchEnd:Canvas.prototype._onTouchEnd,_onMouseMove:move,_onMouseDown:down,_willAddMouseDown:0};
 document.addEventListener('touchmove',move);document.addEventListener('touchend',state._onTouchEnd);
 try{Reflect.apply(finishCancelledFabricTouch,null,[state,{target:element,changedTouches:[{identifier:7,clientX:1,clientY:2}]}]);expect(state).not.toHaveProperty('mainTouchId');expect(state.__onMouseUp).toHaveBeenCalledTimes(1);document.dispatchEvent(new Event('touchmove'));expect(move).not.toHaveBeenCalled();vi.advanceTimersByTime(400);element.dispatchEvent(new MouseEvent('mousedown'));expect(down).toHaveBeenCalledTimes(1);}finally{element.removeEventListener('mousedown',down);element.remove();vi.useRealTimers();}
});
