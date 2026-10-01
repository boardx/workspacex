import {expect,it} from 'vitest';
import {showConnectionHandles as visible} from '@/components/whiteboard/connection-handle-visibility';
const base={id:'a',kind:'sticky',selected:[] as string[],hovered:null,connecting:false,sourceId:null,readOnly:false,selectTool:true};
it('does not turn a thirty-object selection into 120 visible anchors',()=>{
 const selected=Array.from({length:30},(_,i)=>String(i));
 expect(selected.filter(id=>visible({...base,id,selected}))).toEqual([]);
 expect(selected.filter(id=>visible({...base,id,selected,hovered:'4'}))).toEqual(['4']);
});
it('retains touch selection and explicit connector-mode targets',()=>{
 expect(visible({...base,selected:['a']})).toBe(true);
 expect(visible({...base,connecting:true})).toBe(true);
 expect(visible({...base,sourceId:'a'})).toBe(true);
});
it('never exposes editing handles on locked, read-only or container objects',()=>{
 for(const patch of [{locked:true},{readOnly:true},{selectTool:false},{kind:'panel'},{kind:'connector'}])expect(visible({...base,connecting:true,...patch})).toBe(false);
});
