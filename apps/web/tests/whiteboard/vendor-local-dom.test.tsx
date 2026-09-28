import {cleanup,render} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import type {WhiteboardObject} from '@repo/contracts/whiteboard-document';
import {BoardA11yMirror} from '@/components/whiteboard/fabric/board-a11y-mirror';
import {toBoardFabricObjects} from '@/components/whiteboard/whiteboard-fabric-projection';
import {assertVendorLocalObjects,readVendorLocalNodes} from '../../e2e/support/board-vendor-local-proof';
afterEach(cleanup);
it('reads actual mirror DOM including Unicode, parent and rotated connector points; catches stale DOM without a server read',()=>{
 const frame:WhiteboardObject={id:'f',kind:'frame',schemaVersion:1,text:'',geometry:{x:0,y:0,width:400,height:300,rotation:0},style:{},parentId:null,orderKey:'a'};
 const note:WhiteboardObject={...frame,id:'n',kind:'sticky',text:'中文\nsecond line',parentId:'f',geometry:{x:10,y:20,width:100,height:80,rotation:90},orderKey:'b'};
 const edge:WhiteboardObject={...frame,id:'e',kind:'connector',text:'关系',connector:{from:'n',to:'f',type:'straight'},orderKey:'c'};
 const canonical=[frame,note,edge];const view=render(<BoardA11yMirror objects={toBoardFabricObjects(canonical)} selectedObjectIds={[]} onSelect={()=>{}} readOnly={false}/>);
 const nodes=()=>Array.from(view.container.querySelectorAll('li[data-object-id]'));
 expect(()=>assertVendorLocalObjects(readVendorLocalNodes(nodes()),canonical)).not.toThrow();
 view.container.querySelector('[data-object-id="n"] button')!.setAttribute('aria-label','图形：stale');
 expect(()=>assertVendorLocalObjects(readVendorLocalNodes(nodes()),canonical)).toThrow();
 view.container.querySelector('[data-object-id="e"]')!.removeAttribute('data-connector-start');
 expect(()=>assertVendorLocalObjects(readVendorLocalNodes(nodes()),canonical)).toThrow();
});
