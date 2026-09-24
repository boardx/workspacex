'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import * as Y from 'yjs';
import { createWhiteboardDocument } from '@repo/whiteboard-core';
import { CollaborativeEditor } from './collaborative-editor';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { joinRoom,readRoom,type RoomGrant,type RoomState } from '@/lib/live-whiteboard-room';
import {clearRoomSession,isAuthoritativeRoomEnd,newerViewport,persistRoomSession,restoreRoomSession} from '@/lib/whiteboard-room-session';

function bytes(base64:string){const binary=atob(base64);return Uint8Array.from(binary,c=>c.charCodeAt(0));}
export function RoomDisplay(){
  const [payload,setPayload]=useState(''),[grant,setGrant]=useState<RoomGrant|null>(null),[state,setState]=useState<RoomState|null>(null),[error,setError]=useState(''),[follow,setFollow]=useState(true),[reconnecting,setReconnecting]=useState(false),[hydrated,setHydrated]=useState(false);
  const [documentRevision,setDocumentRevision]=useState(0);
  const docRef=useRef<Y.Doc|null>(null);if(!docRef.current)docRef.current=createWhiteboardDocument();
  const resetDocument=useCallback(()=>{const previous=docRef.current;docRef.current=createWhiteboardDocument();previous?.destroy();setDocumentRevision(value=>value+1);},[]);
  useEffect(()=>{const restored=restoreRoomSession();if(restored){setGrant(restored.grant);setFollow(restored.follow);setReconnecting(true);}setHydrated(true);},[]);
  const connect=useCallback(async()=>{setError('');try{const decoded=JSON.parse(payload) as {orgId?:unknown;pairingId?:unknown;code?:unknown};const next=await joinRoom(decoded as never);resetDocument();setState(null);setFollow(true);setReconnecting(true);persistRoomSession({grant:next,follow:true});setGrant(next);}catch{setError('配对载荷无效、已过期或已经使用。请让主持人重新创建。');}},[payload,resetDocument]);
  useEffect(()=>{if(!grant)return;let active=true,inFlight=false,timer:number|undefined,failures=0;const ydoc=docRef.current!;
    const poll=async()=>{if(!active||inFlight)return;inFlight=true;try{const next=await readRoom(grant.sessionId,{orgId:grant.orgId,token:grant.token});if(!active)return;failures=0;if(next.snapshot)Y.applyUpdate(ydoc,bytes(next.snapshot),'room-snapshot');setState(previous=>({...next,viewport:newerViewport(previous?.viewport??null,next.viewport)}));setReconnecting(false);setError('');
      }catch(cause){if(!active)return;if(isAuthoritativeRoomEnd(cause)){setError('会议室连接已过期或被主持人断开。');setGrant(null);setState(null);setReconnecting(false);clearRoomSession(grant.sessionId);resetDocument();return;}failures+=1;setReconnecting(true);setError('连接暂时中断，正在恢复…');}
      finally{inFlight=false;}if(active)timer=window.setTimeout(()=>void poll(),Math.min(5_000,1_500*Math.max(1,failures)));
    };const resume=()=>{if(document.visibilityState==='hidden')return;if(timer)window.clearTimeout(timer);void poll();};window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);void poll();return()=>{active=false;if(timer)window.clearTimeout(timer);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);};},[grant,resetDocument]);
  useEffect(()=>{if(grant)persistRoomSession({grant,follow});},[grant,follow]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&follow){event.preventDefault();setFollow(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[follow]);
  useEffect(()=>()=>docRef.current?.destroy(),[]);
  if(!hydrated||grant&&!state)return <main className="flex h-full items-center justify-center bg-panel-alt"><p role="status">{error||'正在恢复会议室连接…'}</p></main>;
  if(!grant||!state)return <main className="flex h-full min-h-0 items-center justify-center bg-panel-alt p-8"><section className="w-full max-w-xl rounded-container border border-border bg-card p-8 shadow-lg"><h1 className="text-28 font-semibold">会议室大屏</h1><p className="mt-2 text-14 text-muted-foreground">从主持人的“连接会议室”窗口复制配对载荷。连接仅提供短时只读访问。</p><label className="mt-6 block text-13">配对载荷<Textarea autoFocus data-testid="room-join-payload" className="mt-2 min-h-32 font-mono" value={payload} onChange={event=>setPayload(event.target.value)}/></label>{error&&<p role="alert" className="mt-3 text-destructive">{error}</p>}<Button data-testid="room-join" className="mt-4 w-full" disabled={!payload.trim()} onClick={()=>void connect()}>只读连接</Button></section></main>;
  return <main data-testid="room-display-active" data-room-viewport-revision={state.viewport?.revision??0} className="relative h-full min-h-0 bg-background"><div className="absolute right-4 top-3 z-20 flex items-center gap-2 rounded-control border border-border bg-card p-2 shadow"><span className="text-12">{reconnecting?'连接暂时中断，正在恢复…':follow?'正在跟随主持人':'已退出跟随'}</span><Button data-testid="room-follow-toggle" variant="outline" onClick={()=>setFollow(value=>!value)}>{follow?'退出跟随（Esc）':'重新跟随'}</Button><Button variant="ghost" onClick={()=>{clearRoomSession(grant.sessionId);setGrant(null);setState(null);resetDocument();}}>退出会议室</Button></div><CollaborativeEditor key={documentRevision} doc={docRef.current} title={state.boardName} status={`会议室只读 · ${state.seq} 次更新`} readOnly peers={[]} followViewport={follow?state.viewport:null}/><p className="sr-only" aria-live="polite">{error}</p></main>;
}
