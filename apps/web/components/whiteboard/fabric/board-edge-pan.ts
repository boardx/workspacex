export type EdgePanBounds = { left: number; top: number; width: number; height: number };
export type EdgePanPoint = { x: number; y: number };
/** CSS pixels/second, with bounded acceleration toward each exposed edge. */
export function boardEdgePanVelocity(point: EdgePanPoint, bounds: EdgePanBounds): EdgePanPoint {
 if (![point.x,point.y,bounds.left,bounds.top,bounds.width,bounds.height].every(Number.isFinite)||bounds.width<=0||bounds.height<=0) return {x:0,y:0};
 const axis=(position:number,start:number,size:number)=>{
  const margin=Math.min(64,size/4),local=position-start;
  if(local<margin)return 600*Math.min(1,Math.max(0,(margin-local)/margin))**2;
  if(local>size-margin)return -600*Math.min(1,Math.max(0,(local-size+margin)/margin))**2;
  return 0;
 };
 return {x:axis(point.x,bounds.left,bounds.width),y:axis(point.y,bounds.top,bounds.height)};
}

export function createBoardEdgePan(options: {
 bounds:()=>EdgePanBounds; active:()=>boolean; pan:(delta:EdgePanPoint)=>void;
 request:(callback:FrameRequestCallback)=>number; cancel:(id:number)=>void;
}) {
 let frame:number|null=null,last:number|null=null,point:EdgePanPoint|null=null,disposed=false;
 const stop=()=>{if(frame!==null)options.cancel(frame);frame=null;last=null;point=null;};
 const tick=(time:number)=>{
  frame=null;
  if(disposed||!point||!options.active()){stop();return;}
  const velocity=boardEdgePanVelocity(point,options.bounds());
  if(!velocity.x&&!velocity.y){stop();return;}
  if(last!==null){const seconds=Math.min(.05,Math.max(0,(time-last)/1000));options.pan({x:velocity.x*seconds,y:velocity.y*seconds});}
  if(disposed||!point||!options.active()){stop();return;}
  last=time;frame=options.request(tick);
 };
 return {
  update(next:EdgePanPoint){if(disposed)return;point=next;if(!options.active()){stop();return;}const velocity=boardEdgePanVelocity(next,options.bounds());if(!velocity.x&&!velocity.y){stop();return;}if(frame===null)frame=options.request(tick);},
  stop,
  dispose(){disposed=true;stop();},
 };
}
