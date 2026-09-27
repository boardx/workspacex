'use client';
import type { WhiteboardPresentationState } from '@repo/contracts/whiteboard-operation';
import { Button } from '@/components/ui/button';

export function BoardPresentationControls({state,actorId,canPresent,handoffTargetActorId,onClaim,onRelease,onFollow,onLeave,onHandoff}:{state:WhiteboardPresentationState;actorId:string;canPresent:boolean;handoffTargetActorId?:string;onClaim:()=>void;onRelease:()=>void;onFollow:()=>void;onLeave:()=>void;onHandoff:(actorId:string)=>void}){
  const presenting=state.presenterId===actorId,following=state.followers.includes(actorId);
  return <div data-testid="board-presentation-controls" className="absolute right-4 top-4 z-30 flex items-center gap-2 rounded-container border border-border bg-card p-2 shadow-md">
    {presenting?<><span className="text-12">你正在演示</span>{handoffTargetActorId?<Button size="sm" variant="outline" onClick={()=>onHandoff(handoffTargetActorId)}>交给会议室</Button>:null}<Button size="sm" onClick={onRelease}>结束演示</Button></>:following?<><span className="text-12">正在跟随 {state.presenterId}</span><Button size="sm" variant="outline" onClick={onLeave}>自由浏览</Button></>:state.presenterId?<Button size="sm" onClick={onFollow}>跟随演示者</Button>:canPresent?<Button size="sm" onClick={onClaim}>开始演示</Button>:<span className="text-12 text-muted-foreground">暂无演示者</span>}
  </div>;
}
