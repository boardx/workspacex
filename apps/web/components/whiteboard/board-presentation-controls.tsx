'use client';
import type { WhiteboardPresentationState } from '@repo/contracts/whiteboard-operation';
import {Play,Square,LogOut,Users} from 'lucide-react';
import { Button } from '@/components/ui/button';

export function BoardPresentationControls({inline=false,state,actorId,canPresent,handoffTargetActorId,onClaim,onRelease,onFollow,onLeave,onHandoff}:{inline?:boolean;state:WhiteboardPresentationState;actorId:string;canPresent:boolean;handoffTargetActorId?:string;onClaim:()=>void;onRelease:()=>void;onFollow:()=>void;onLeave:()=>void;onHandoff:(actorId:string)=>void}){
  const presenting=state.presenterId===actorId,following=state.followers.includes(actorId);
  return <div data-testid="board-presentation-controls" className={inline?"flex items-center gap-1":"absolute right-4 top-36 sm:top-20 z-30 flex items-center gap-2 rounded-container border border-border bg-card p-2 shadow-md"}>
    {presenting?<>{!inline?<span className="text-12">你正在演示</span>:null}{handoffTargetActorId?<Button size="sm" variant="outline" onClick={()=>onHandoff(handoffTargetActorId)}>交给会议室</Button>:null}<Button size="sm" onClick={onRelease} aria-label="结束演示" title="结束演示" className="min-h-11 min-w-11">{inline?<Square className="h-5 w-5"/>:"结束演示"}</Button></>:following?<>{!inline?<span className="text-12">正在跟随 {state.presenterId}</span>:null}<Button size="sm" variant="outline" onClick={onLeave} aria-label="自由浏览" title="自由浏览" className="min-h-11 min-w-11">{inline?<LogOut className="h-5 w-5"/>:"自由浏览"}</Button></>:state.presenterId?<Button size="sm" onClick={onFollow} aria-label="跟随演示者" title="跟随演示者" className="min-h-11 min-w-11">{inline?<Users className="h-5 w-5"/>:"跟随演示者"}</Button>:canPresent?<Button size="sm" onClick={onClaim} aria-label="开始演示" title="开始演示" className="min-h-11 min-w-11">{inline?<Play className="h-5 w-5"/>:"开始演示"}</Button>:inline?null:<span className="text-12 text-muted-foreground">暂无演示者</span>}
  </div>;
}
