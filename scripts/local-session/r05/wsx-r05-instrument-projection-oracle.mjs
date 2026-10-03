import assert from 'node:assert/strict';

export function assertInstrumentProjection({choice,stroke,view,start,end}) {
 assert(Object.values(view).every(Number.isFinite)&&view.zoom>0);
 const expectedZoom=choice==='pencil'?4:1;
 assert(Math.abs(view.zoom-expectedZoom)<.001);
 assert(stroke.points.length>=2&&stroke.points.every(p=>[p.x,p.y,p.pressure].every(Number.isFinite)&&Math.abs(p.pressure-.5)<.01));
 for(const [point,screen] of [[stroke.points[0],start],[stroke.points.at(-1),end]]) {
  assert(Math.abs(point.x-(screen.x-view.left-view.panX)/view.zoom)<.01);
  assert(Math.abs(point.y-(screen.y-view.top-view.panY)/view.zoom)<.01);
 }
 if(choice==='pencil') {
  assert.equal(stroke.width,2);assert.equal(stroke.opacity,.65);
  assert(stroke.width*(.35+.5*.65)*view.zoom>=5.4-.002);
 }
}
