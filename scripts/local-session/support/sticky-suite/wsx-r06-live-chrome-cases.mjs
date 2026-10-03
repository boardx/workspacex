import assert from 'node:assert/strict';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
const anchors={left:[0,.5],top:[.5,0],right:[1,.5],bottom:[.5,1]};
const screen=(point,view)=>({x:view.x+view.panX+point.x*view.zoom,y:view.y+view.panY+point.y*view.zoom});
export async function assertLiveStickyChrome(page,id,expectedGeometry,view){
 const points=[];
 for(const[anchor,[fx,fy]]of Object.entries(anchors)){
  const expected=screen(rotatedPoint(expectedGeometry,{x:fx*expectedGeometry.width,y:fy*expectedGeometry.height}),view);
  const locator=page.getByTestId(`connector-handle-${id}-${anchor}`);assert(await locator.isVisible(),`missing live ${anchor} point`);
  const box=await locator.boundingBox();assert(box);const actual={x:box.x+box.width/2,y:box.y+box.height/2};
  assert(Math.hypot(actual.x-expected.x,actual.y-expected.y)<=2,`${anchor} point lags live native transform`);points.push({anchor,expected,actual});
 }
 const toolbar=page.getByTestId('board-context-toolbar');assert(await toolbar.isVisible());const box=await toolbar.boundingBox();assert(box);
 const corners=[[0,0],[1,0],[1,1],[0,1]].map(([fx,fy])=>screen(rotatedPoint(expectedGeometry,{x:fx*expectedGeometry.width,y:fy*expectedGeometry.height}),view));
 const minY=Math.min(...corners.map(p=>p.y)),minX=Math.min(...corners.map(p=>p.x)),maxX=Math.max(...corners.map(p=>p.x));
 assert(box.y+box.height<minY,'controlled central fixture must keep its menu above the live note');
 const center=(minX+maxX)/2;assert(Math.abs(box.x+box.width/2-center)<=2,'unclamped central toolbar lags live note');
 return{points,toolbar:box,expectedGeometry};
}
export async function runStickyLiveGraph(ctx){
 const id=await ctx.createStickyNative('rectangle','yellow'),target=await ctx.createStickyNative('square','blue');
 await ctx.seedExistingConnector(id,target,{fromAnchor:'right',toAnchor:'left',type:'straight',startStyle:'none',endStyle:'none'});
 const before=await ctx.state(),note=before.objects.find(item=>item.id===id),fixed=before.objects.find(item=>item.id===target);assert(note&&fixed);
 const view=await ctx.view(),center=screen(rotatedPoint(note.geometry,{x:note.geometry.width/2,y:note.geometry.height/2}),view);
 await ctx.page.getByTestId('board-tool-select').click();await ctx.page.mouse.click(center.x,center.y);
 await ctx.page.mouse.move(center.x,center.y);await ctx.page.mouse.down();await ctx.page.mouse.move(center.x+31,center.y+27,{steps:12});
 await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.deepEqual(await ctx.state(),before);
 const expected={...note.geometry,x:note.geometry.x+31/view.zoom,y:note.geometry.y+27/view.zoom};
 const chrome=await assertLiveStickyChrome(ctx.page,id,expected,view);
 const endpoint=rotatedPoint(expected,{x:expected.width,y:expected.height/2}),opposite=rotatedPoint(fixed.geometry,{x:0,y:fixed.geometry.height/2});
 await ctx.assertExistingEdgeRaster({movingEndpoint:endpoint,fixedEndpoint:opposite,oldMovingEndpoint:rotatedPoint(note.geometry,{x:note.geometry.width,y:note.geometry.height/2}),view});
 await ctx.shot('S11-native-move-held');await ctx.page.mouse.up();
 const after=await ctx.poll(state=>state.head.seq===before.head.seq+1);assert.deepEqual(after.objects.find(item=>item.id===target),fixed);
 return{case:'S11',status:'native-move-live-subset',requiredSuiteComplete:false,chrome,endpoint,opposite,pending:['resize live graph','rotation live graph']};
}
