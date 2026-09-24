'use client';
import { useEffect, useRef, useState } from 'react';
import type * as C from '@repo/contracts/whiteboard-workshop';
import type { Board } from '@/lib/live-whiteboard';
import * as api from '@/lib/live-whiteboard-workshop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface WorkshopPanelProps { boardId:string; role:Board['role']; selectedObjectId?:string; currentUserId?:string }
export function WorkshopPanel({boardId,role,selectedObjectId,currentUserId}:WorkshopPanelProps){
  const [open,setOpen]=useState(false),[comments,setComments]=useState<C.Comment[]>([]),[votes,setVotes]=useState<C.Vote[]>([]);
  const [timer,setTimer]=useState<C.Timer>({deadline:null,running:false});
  const [comment,setComment]=useState(''),[draft,setDraft]=useState(''),[draftSaved,setDraftSaved]=useState('');
  const [draftRevision,setDraftRevision]=useState<string|null>(null),[publishConsent,setPublishConsent]=useState(false);
  const [title,setTitle]=useState('优先级投票'),[quota,setQuota]=useState(3),[seconds,setSeconds]=useState(300);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[now,setNow]=useState(Date.now());
  const lock=useRef(false),generation=useRef(0),requests=useRef(new Map<string,string>()),loadedBoard=useRef<string|null>(null),activeBoard=useRef(boardId);
  const requestId=(key:string)=>{let id=requests.current.get(key);if(!id){id=crypto.randomUUID();requests.current.set(key,id);}return id;};
  useEffect(()=>{const g=++generation.current;if(activeBoard.current!==boardId){activeBoard.current=boardId;loadedBoard.current=null;setComments([]);setVotes([]);setDraft('');setDraftSaved('');setDraftRevision(null);setPublishConsent(false);setComment('');setError('');setNotice('');requests.current.clear();}
    if(!open)return;
    let stopped=false;setLoading(true);
    const refresh=async(initial=false)=>{try{
      const [c,v,t,d]=await Promise.all([api.listWorkshopComments(boardId),api.listWorkshopVotes(boardId),api.getWorkshopTimer(boardId),initial?api.getWorkshopDraft(boardId):Promise.resolve(null)]);
      if(stopped||g!==generation.current)return;setComments(c);setVotes(v);setTimer(t);if(d){setDraft(d.text);setDraftSaved(d.text);setDraftRevision(d.revision);loadedBoard.current=boardId;}setLoading(false);
    }catch(e){if(!stopped&&g===generation.current){setError(e instanceof Error?e.message:'工作坊加载失败');setLoading(false);}}};
    void refresh(loadedBoard.current!==boardId);const interval=setInterval(()=>void refresh(),5000);const clock=setInterval(()=>setNow(Date.now()),1000);
    return()=>{stopped=true;clearInterval(interval);clearInterval(clock);};
  },[boardId,open]);
  const run=async(key:string,action:(current:()=>boolean)=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');const g=generation.current;
    try{await action(()=>g===generation.current);if(g===generation.current){requests.current.delete(key);setNotice('已保存');}}
    catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'操作失败，请重试');}
    finally{lock.current=false;setBusy(false);}
  };
  const owner=role==='owner';const write=role!=='viewer';const remaining=timer.deadline?Math.max(0,Math.ceil((Date.parse(timer.deadline)-now)/1000)):0;
  return <aside data-testid="board-workshop-panel" className="max-h-full w-80 max-w-full overflow-y-auto rounded-xl border bg-background p-3 text-foreground shadow-sm" aria-label="工作坊">
    <Button variant="outline" className="w-full" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>工作坊 {open?'收起':'展开'}</Button>
    {open&&<div className="mt-3 max-h-[70vh] space-y-4 overflow-y-auto">
      {loading&&<p role="status">正在加载工作坊…</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}{notice&&<p role="status">{notice}</p>}
      <details open><summary>评论</summary><p className="text-sm text-muted-foreground">{selectedObjectId?`关联对象：${selectedObjectId}`:'当前评论关联整块白板'}</p>
        <ul className="space-y-2">{comments.map(c=><li key={c.id} className="rounded border p-2"><p className="whitespace-pre-wrap">{c.text}</p><small>{c.authorId}</small>{(owner||c.authorId===currentUserId)&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>void run(`delete-${c.id}`,async current=>{await api.deleteWorkshopComment(boardId,c.id);if(!current())return;setComments(items=>items.filter(item=>item.id!==c.id));})}>删除评论</Button>}</li>)}</ul>
        {write&&<><Textarea disabled={busy||loading} aria-label="评论内容" value={comment} maxLength={4000} onChange={e=>setComment(e.target.value)}/><Button disabled={busy||loading||!comment.trim()} onClick={()=>{const key=`comment:${selectedObjectId}:${comment}`;void run(key,async current=>{const saved=await api.addWorkshopComment(boardId,{requestId:requestId(key),objectId:selectedObjectId??null,text:comment});if(!current())return;setComments(items=>[...items.filter(item=>item.id!==saved.id),saved]);setComment('');});}}>发表评论</Button></>}
      </details>
      <details><summary>私密草稿</summary><p className="text-sm text-muted-foreground">仅自己可见，尚未发布到白板。发布前共享和导出不会包含此草稿。</p>
        <Textarea disabled={busy||loading} aria-label="私密草稿" maxLength={20000} value={draft} onChange={e=>setDraft(e.target.value)}/><Button disabled={busy||loading||draft===draftSaved} onClick={()=>void run('draft',async current=>{const saved=await api.saveWorkshopDraft(boardId,{text:draft});if(!current())return;setDraftSaved(saved.text);setDraftRevision(saved.revision);setPublishConsent(false);})}>保存私密草稿</Button>{draft!==draftSaved&&<span className="text-sm text-muted-foreground">未保存</span>}{write&&<div className="space-y-2"><label className="flex gap-2 text-sm"><input type="checkbox" checked={publishConsent} onChange={e=>setPublishConsent(e.target.checked)}/>我确认发布后所有白板成员都可见</label><Button disabled={busy||loading||!publishConsent||!draftRevision||!draft.trim()||draft!==draftSaved} onClick={()=>{const key=`publish:${draftRevision}`;void run(key,async current=>{await api.publishWorkshopDraft(boardId,{requestId:requestId(key),expectedRevision:draftRevision!,geometry:{x:0,y:0,width:240,height:180,rotation:0}});if(!current())return;setDraft('');setDraftSaved('');setDraftRevision(null);setPublishConsent(false);});}}>发布为白板便利贴</Button><p className="text-sm text-muted-foreground">先保存再发布。发布会清空该版本私密草稿，在白板原点创建一张可移动便利贴。</p></div>}
      </details>
      <details><summary>匿名投票</summary><p className="text-sm text-muted-foreground">投票进行中仅显示自己的已用额度，结束后显示聚合票数。</p>
        {votes.map(v=><section key={v.id} className="my-2 rounded border p-2"><p>{v.title} · 已用 {v.used}/{v.quota}</p><p className="text-sm">{v.closed?'已结束':Date.parse(v.deadline)<=now?'正在确认投票结果…':`截止 ${new Date(v.deadline).toLocaleTimeString()}`}</p>
          {!v.closed&&<p className="text-sm text-muted-foreground">结果将在投票结束后显示</p>}
          {v.objectIds.map(objectId=><div key={objectId} className="flex items-center justify-between gap-2"><span className="truncate">{v.closed?`${objectId}：${v.results.find(r=>r.objectId===objectId)?.count??0} 票`:objectId}</span><Button size="sm" variant="outline" disabled={busy||v.closed||Date.parse(v.deadline)<=now||v.used>=v.quota} onClick={()=>{const key=`ballot:${v.id}:${objectId}`;void run(key,async current=>{const saved=await api.castWorkshopVote(boardId,v.id,{requestId:requestId(key),objectId,count:1});if(!current())return;setVotes(items=>items.map(item=>item.id===saved.id?saved:item));});}}>投一票</Button></div>)}
          {owner&&!v.closed&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void run(`close:${v.id}`,async current=>{const saved=await api.closeWorkshopVote(boardId,v.id);if(!current())return;setVotes(items=>items.map(item=>item.id===saved.id?saved:item));})}>结束投票</Button>}
        </section>)}
        {owner&&<><Input aria-label="投票标题" value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/><label>每人票数<Input aria-label="每人票数" type="number" min={1} max={100} value={quota} onChange={e=>setQuota(Number(e.target.value))}/></label><p className="text-sm text-muted-foreground">首个投票目标使用当前选中的对象。</p><Button disabled={busy||loading||!selectedObjectId||!title.trim()||quota<1||quota>100||seconds<1||seconds>86400} onClick={()=>{const key=`vote:${title}:${quota}:${seconds}:${selectedObjectId}`;void run(key,async current=>{const saved=await api.createWorkshopVote(boardId,{requestId:requestId(key),title,quota,durationSeconds:seconds,objectIds:[selectedObjectId!]});if(!current())return;setVotes(items=>[saved,...items.filter(item=>item.id!==saved.id)]);});}}>发起投票</Button></>}
      </details>
      <details><summary>计时器</summary><p aria-live="polite">{timer.running&&remaining>0?`剩余 ${remaining} 秒`:'计时已停止或结束'}</p>{owner&&<><label>计时与新投票时长（秒）<Input aria-label="时长秒数" type="number" min={1} max={86400} value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></label><Button disabled={busy||loading||seconds<1||seconds>86400} onClick={()=>void run('timer',async current=>{const value=await api.startWorkshopTimer(boardId,{durationSeconds:seconds});if(current())setTimer(value);})}>开始计时</Button><Button variant="outline" disabled={busy||!timer.running} onClick={()=>void run('stop-timer',async current=>{const value=await api.stopWorkshopTimer(boardId);if(current())setTimer(value);})}>停止计时</Button></>}</details>
    </div>}
  </aside>;
}
