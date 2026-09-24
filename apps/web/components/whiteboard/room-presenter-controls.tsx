'use client';
import { useEffect, useState } from 'react';
import { MonitorUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogDescription,DialogTitle } from '@/components/ui/dialog';
import { createRoomPairing,readPairingStatus,revokeRoom,type RoomPairing } from '@/lib/live-whiteboard-room';
import {isAuthoritativeRoomEnd,persistPresenterSession,restorePresenterSession} from '@/lib/whiteboard-room-session';

export function RoomPresenterControls({boardId,disabled,onSession}:{boardId:string;disabled:boolean;onSession:(sessionId:string|null)=>void}){
  const [open,setOpen]=useState(false),[pairing,setPairing]=useState<RoomPairing|null>(null),[sessionId,setSessionId]=useState<string|null>(()=>restorePresenterSession(boardId)),[error,setError]=useState('');
  useEffect(()=>{onSession(sessionId);},[onSession,sessionId]);
  useEffect(()=>{if(!pairing||sessionId)return;const timer=window.setInterval(()=>{void readPairingStatus(boardId,pairing.id).then(status=>{if(status.sessionId){persistPresenterSession(boardId,status.sessionId);setSessionId(status.sessionId);}}).catch(()=>setError('配对已过期，请重新创建。'));},1500);return()=>window.clearInterval(timer);},[boardId,pairing,sessionId]);
  async function begin(){setError('');try{const next=await createRoomPairing(boardId,crypto.randomUUID());setPairing(next);setOpen(true);}catch{setError('无法创建会议室连接，请确认你仍有编辑权限。');setOpen(true);}}
  async function stop(){if(sessionId)try{await revokeRoom(boardId,sessionId);}catch(cause){if(!isAuthoritativeRoomEnd(cause)){setError('暂时无法断开会议室，请稍后重试。');return;}}persistPresenterSession(boardId,null);setSessionId(null);setPairing(null);setOpen(false);}
  return <><Button data-testid="room-present-open" variant="outline" disabled={disabled} onClick={()=>sessionId?setOpen(true):void begin()}><MonitorUp className="h-4 w-4"/>连接会议室</Button><Dialog open={open} onOpenChange={value=>{setOpen(value);if(!value&&!sessionId)setPairing(null);}}><DialogContent><DialogTitle>在会议室大屏打开白板</DialogTitle>{error?<p role="alert">{error}</p>:sessionId?<><DialogDescription>大屏已只读连接。移动或缩放画布时，大屏会跟随；大屏也可以随时退出跟随。</DialogDescription><p data-testid="room-connected" className="rounded-control bg-success-tint p-3 text-success-tint-foreground">会议室已连接</p><Button variant="destructive" onClick={()=>void stop()}>断开会议室</Button></>:pairing?<><DialogDescription>在大屏打开“会议室模式”，粘贴配对载荷。配对码 5 分钟内有效且只能使用一次。</DialogDescription><p data-testid="room-pairing-code" className="select-all text-center font-mono text-28 tracking-[0.3em]">{pairing.code}</p><label className="text-12">配对载荷<textarea data-testid="room-pairing-payload" className="mt-1 h-20 w-full rounded-control border border-border bg-background p-2 font-mono text-11" readOnly value={pairing.payload}/></label><p role="status" className="text-12 text-muted-foreground">等待大屏连接… 不要在公开频道分享此载荷。</p></>:<p role="status">正在创建短时配对码…</p>}</DialogContent></Dialog></>;
}
