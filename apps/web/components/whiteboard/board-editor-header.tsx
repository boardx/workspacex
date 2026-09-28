'use client';
import {useSyncExternalStore,type ReactNode} from 'react';
import {ChevronDown,Cloud,MoreHorizontal,ArrowLeft,FileInput,CircleHelp} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {WorkspaceXWordmark} from '@/components/shell/workspacex-logo';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {BoardToolPopover} from './board-tool-popover';
import {BoardShareDialog} from './board-share-dialog';
const compactQuery = '(max-width: 1279px)';
const subscribeCompact = (notify: () => void) => {
 if (typeof window.matchMedia !== 'function') return () => {};
 const query = window.matchMedia(compactQuery); query.addEventListener('change', notify);
 return () => query.removeEventListener('change', notify);
};
const isCompact = () => typeof window.matchMedia === 'function' && window.matchMedia(compactQuery).matches;
export function BoardEditorHeader({boardId,title,status,readOnly,onBack,onImport,onTitleChange,history,peers,presentation,more,userAvatar}:{boardId:string;title:string;status:string;readOnly:boolean;onBack?:()=>void;onImport?:()=>void;onTitleChange?:(value:string)=>void;history:ReactNode;peers:ReactNode;presentation?:ReactNode;more:ReactNode;userAvatar?:ReactNode}){
 const compact=useSyncExternalStore(subscribeCompact,isCompact,()=>false);
 return <header data-testid="board-editor-header" data-board-chrome="header" className="absolute inset-x-0 top-0 z-40 flex h-16 items-center gap-2 border-b border-border-subtle bg-background px-3 shadow-sm sm:gap-3 sm:px-5">
  <Button variant="ghost" aria-label="返回白板" title="返回白板" disabled={!onBack} onClick={onBack} className="min-h-11 min-w-11 shrink-0 rounded-xl px-1"><WorkspaceXWordmark className="hidden h-10 w-32 object-contain xl:block"/><span className="xl:hidden"><ArrowLeft className="h-5 w-5"/></span></Button>
  <span className="hidden h-6 w-px shrink-0 bg-border sm:block"/>
  <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" data-testid="board-title-menu" title={title} className="min-h-11 min-w-0 max-w-56 gap-2 px-2"><span className="truncate font-medium">{title}</span><ChevronDown className="h-4 w-4 shrink-0"/></Button></DropdownMenuTrigger><DropdownMenuContent align="start">{onBack?<DropdownMenuItem onSelect={onBack}><ArrowLeft className="h-4 w-4"/>返回白板浏览</DropdownMenuItem>:null}{onImport?<DropdownMenuItem data-testid="board-import-open" disabled={readOnly} onSelect={onImport}><FileInput className="h-4 w-4"/>导入 Miro / Mural</DropdownMenuItem>:null}{<div className="p-2"><Input aria-label="白板名称" value={title} disabled={readOnly||!onTitleChange} onChange={event=>onTitleChange?.(event.target.value)}/></div>}</DropdownMenuContent></DropdownMenu>
  <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2 [&_button]:min-h-10 [&_button]:min-w-10 [&_button]:rounded-xl [&_button]:px-2">{history}</div>
  <span data-testid="board-sync-status" role="status" aria-label={status+(readOnly?' · 只读':'')} title={status+(readOnly?' · 只读':'')} className="flex min-w-0 max-w-44 items-center gap-2 whitespace-nowrap text-13 text-foreground"><Cloud aria-hidden className="h-5 w-5 shrink-0"/><span className="hidden truncate xl:inline">{status}{readOnly?' · 只读':''}</span></span>
  <div className="ml-auto flex shrink-0 items-center gap-2">{!compact?peers:null}<BoardShareDialog boardId={boardId}/>{!compact?presentation:null}<BoardToolPopover label="白板操作" trigger={<Button variant="ghost" size="icon" aria-label="更多白板操作" title="更多白板操作" className="min-h-11 min-w-11 rounded-xl"><MoreHorizontal className="h-5 w-5"/></Button>}>{compact?<><section aria-label="在线成员" className="mb-4 space-y-2"><h3 className="text-13 font-medium">在线成员</h3>{peers}</section>{presentation?<section aria-label="会议与演示" className="mb-4 space-y-2"><h3 className="text-13 font-medium">会议与演示</h3>{presentation}</section>:null}</>:null}{more}</BoardToolPopover><BoardToolPopover label="白板帮助" trigger={<Button data-testid="board-help-open" variant="ghost" size="icon" aria-label="白板帮助" title="白板帮助" className="hidden min-h-11 min-w-11 rounded-full sm:inline-flex"><CircleHelp className="h-5 w-5"/></Button>}><p className="text-13 text-muted-foreground">使用底部工具创建内容；按 V 选择对象、按 H 移动画布，按 1 适应全部内容。</p></BoardToolPopover>{userAvatar?<span data-testid="board-user-avatar" className="hidden shrink-0 sm:inline-flex">{userAvatar}</span>:null}</div>
 </header>;
}
