'use client';
import {useEffect,useState} from 'react';
import {Link2,Users} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {listBoardMembers,type BoardMember} from '@/lib/live-whiteboard';
export function BoardShareDialog({boardId}:{boardId:string}){
 const [open,setOpen]=useState(false),[members,setMembers]=useState<BoardMember[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 useEffect(()=>{if(!open)return;let active=true;setLoading(true);setError('');setCopied(false);listBoardMembers(boardId).then(items=>{if(active)setMembers(items);}).catch(()=>{if(active)setError('暂时无法读取成员权限。复制链接不会新增访问权限。');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[open,boardId]);
 return <><Button data-testid="board-share-open" aria-label="分享白板" title="分享白板" className="min-h-11 min-w-11 shrink-0 gap-2 rounded-xl" variant="primary" onClick={()=>setOpen(true)}><Users className="h-4 w-4"/><span className="hidden md:inline">分享</span></Button><Dialog open={open} onOpenChange={setOpen}><DialogContent data-testid="board-share-dialog"><DialogTitle>分享白板</DialogTitle><DialogDescription>只有已获授权的成员能够打开这个链接。复制链接不会修改白板权限。</DialogDescription>{loading?<p role="status">正在读取成员权限…</p>:error?<p role="alert">{error}</p>:<p className="text-13 text-muted-foreground">已授权 {members.length} 位协作者（不含白板所有者）。</p>}<Button data-testid="board-share-copy" onClick={async()=>{setCopied(false);try{await navigator.clipboard.writeText(`${window.location.origin}/studio/board/${encodeURIComponent(boardId)}`);setCopied(true);}catch{setError('无法复制链接，请从浏览器地址栏复制。');}}}><Link2 className="mr-2 h-4 w-4"/>{copied?'链接已复制':'复制白板链接'}</Button></DialogContent></Dialog></>;
}
