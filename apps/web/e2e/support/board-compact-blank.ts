import type {WhiteboardObject} from '@repo/whiteboard-core';

type View = {x:number;y:number;width:number;height:number;zoom:number;panX:number;panY:number};

/** This fixture contains only unrotated notes; refuse other geometry instead of guessing a hit. */
export function compactBlankPoints(view:View,objects:ReadonlyArray<Pick<WhiteboardObject,'geometry'>>) {
  if(!Object.values(view).every(Number.isFinite)||view.zoom<=0||view.width<=48||view.height<=48)throw new Error('INVALID_COMPACT_VIEW');
  const bounds=objects.map(({geometry:g})=>{
    if(![g.x,g.y,g.width,g.height,g.rotation].every(Number.isFinite)||g.rotation!==0||g.width<=0||g.height<=0)throw new Error('UNSUPPORTED_COMPACT_GEOMETRY');
    return {left:view.x+view.panX+g.x*view.zoom-20,top:view.y+view.panY+g.y*view.zoom-20,
      right:view.x+view.panX+(g.x+g.width)*view.zoom+20,bottom:view.y+view.panY+(g.y+g.height)*view.zoom+20};
  });
  const points=[24,view.width/2,view.width-24].flatMap(x=>[24,view.height/2,view.height-24].map(y=>({x:view.x+x,y:view.y+y})))
    .filter(p=>bounds.every(b=>p.x<b.left||p.x>b.right||p.y<b.top||p.y>b.bottom));
  if(!points.length)throw new Error('NO_VERIFIED_COMPACT_BLANK');
  return points;
}
