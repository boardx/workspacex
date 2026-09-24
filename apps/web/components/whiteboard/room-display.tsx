'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import * as Y from 'yjs';
import { createWhiteboardDocument } from '@repo/whiteboard-core';
import { CollaborativeEditor } from './collaborative-editor';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { joinRoom,readRoom,type RoomGrant,type RoomState } from '@/lib/live-whiteboard-room';

const storageKey=(id:string)=>`wsx.board.room.${id}`;
function bytes(base64:string){const binary=atob(base64);return Uint8Array.from(binary,c=>c.charCodeAt(0));}
export function RoomDisplay(){
  const [payload,setPayload]=useState(''),[grant,setGrant]=useState<RoomGrant|null>(null),[state,setState]=useState<RoomState|null>(null),[error,setError]=useState(''),[follow,setFollow]=useState(true);
  const [documentRevision,setDocumentRevision]=useState(0);
  const docRef=useRef<Y.Doc|null>(null);if(!docRef.current)docRef.current=createWhiteboardDocument();
  const resetDocument=useCallback(()=>{const previous=docRef.current;docRef.current=createWhiteboardDocument();previous?.destroy();setDocumentRevision(value=>value+1);},[]);
  const connect=useCallback(async()=>{setError('');try{const decoded=JSON.parse(payload) as {orgId?:unknown;pairingId?:unknown;code?:unknown};const next=await joinRoom(decoded as never);resetDocument();setState(null);setFollow(true);sessionStorage.setItem(storageKey(next.sessionId),JSON.stringify(next));setGrant(next);}catch{setError('配对载荷无效、已过期或已经使用。请让主持人重新创建。');}},[payload,resetDocument]);
  useEffect(()=>{if(!grant)return;let active=true;const document=docRef.current!;const poll=async()=>{try{const next=await readRoom(grant.sessionId,{orgId:grant.orgId,token:grant.token});if(!active)return;if(next.snapshot)Y.applyUpdate(document,bytes(next.snapshot),'room-snapshot');setState(next);setError('');}catch{if(active){setError('会议室连接已过期或被主持人断开。');setGrant(null);setState(null);sessionStorage.removeItem(storageKey(grant.sessionId));resetDocument();}}};void poll();const timer=window.setInterval(()=>void poll(),1500);return()=>{active=false;window.clearInterval(timer);};},[grant,resetDocument]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&follow){event.preventDefault();setFollow(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[follow]);
  useEffect(()=>()=>docRef.current?.destroy(),[]);
  if(!grant||!state)return <main className="flex h-full min-h-0 items-center justify-center bg-panel-alt p-8"><section className="w-full max-w-xl rounded-container border border-border bg-card p-8 shadow-lg"><h1 className="text-28 font-semibold">会议室大屏</h1><p className="mt-2 text-14 text-muted-foreground">从主持人的“连接会议室”窗口复制配对载荷。连接仅提供短时只读访问。</p><label className="mt-6 block text-13">配对载荷<Textarea autoFocus data-testid="room-join-payload" className="mt-2 min-h-32 font-mono" value={payload} onChange={event=>setPayload(event.target.value)}/></label>{error&&<p role="alert" className="mt-3 text-destructive">{error}</p>}<Button data-testid="room-join" className="mt-4 w-full" disabled={!payload.trim()} onClick={()=>void connect()}>只读连接</Button></section></main>;
  return <main className="relative h-full min-h-0 bg-background"><div className="absolute right-4 top-3 z-20 flex items-center gap-2 rounded-control border border-border bg-card p-2 shadow"><span className="text-12">{follow?'正在跟随主持人':'已退出跟随'}</span><Button data-testid="room-follow-toggle" variant="outline" onClick={()=>setFollow(value=>!value)}>{follow?'退出跟随（Esc）':'重新跟随'}</Button><Button variant="ghost" onClick={()=>{sessionStorage.removeItem(storageKey(grant.sessionId));setGrant(null);setState(null);resetDocument();}}>退出会议室</Button></div><CollaborativeEditor key={documentRevision} doc={docRef.current} title={state.boardName} status={`会议室只读 · ${state.seq} 次更新`} readOnly peers={[]} followViewport={follow?state.viewport:null}/><p className="sr-only" aria-live="polite">{error}</p></main>;
}
