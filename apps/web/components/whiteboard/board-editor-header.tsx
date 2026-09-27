'use client';
import type {ReactNode} from 'react';
import {ChevronDown,Cloud,MoreHorizontal,ArrowLeft,FileInput} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {WorkspaceXWordmark} from '@/components/shell/workspacex-logo';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {BoardToolPopover} from './board-tool-popover';
import {BoardShareDialog} from './board-share-dialog';
export function BoardEditorHeader({boardId,title,status,readOnly,onBack,onImport,onTitleChange,history,peers,presentation,more}:{boardId:string;title:string;status:string;readOnly:boolean;onBack?:()=>void;onImport?:()=>void;onTitleChange?:(value:string)=>void;history:ReactNode;peers:ReactNode;presentation?:ReactNode;more:ReactNode}){
 return <header data-testid="board-editor-header" data-board-chrome="header" className="absolute inset-x-0 top-0 z-40 flex h-16 items-center gap-2 border-b border-border-subtle bg-background/95 px-3 backdrop-blur sm:gap-3 sm:px-5">
  <Button variant="ghost" aria-label="返回白板" title="返回白板" disabled={!onBack} onClick={onBack} className="min-h-11 min-w-11 shrink-0 px-1"><WorkspaceXWordmark className="hidden h-6 w-28 object-contain lg:block"/><span className="lg:hidden"><ArrowLeft className="h-5 w-5"/></span></Button>
  <span className="hidden h-6 w-px shrink-0 bg-border sm:block"/>
  <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" data-testid="board-title-menu" title={title} className="min-h-11 min-w-0 max-w-56 gap-2 px-2"><span className="truncate font-medium">{title}</span><ChevronDown className="h-4 w-4 shrink-0"/></Button></DropdownMenuTrigger><DropdownMenuContent align="start">{onBack?<DropdownMenuItem onSelect={onBack}><ArrowLeft className="h-4 w-4"/>返回白板浏览</DropdownMenuItem>:null}{onImport?<DropdownMenuItem data-testid="board-import-open" disabled={readOnly} onSelect={onImport}><FileInput className="h-4 w-4"/>导入 Miro / Mural</DropdownMenuItem>:null}{<div className="p-2"><Input aria-label="白板名称" value={title} disabled={readOnly||!onTitleChange} onChange={event=>onTitleChange?.(event.target.value)}/></div>}</DropdownMenuContent></DropdownMenu>
  <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2 [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:px-2">{history}</div>
  <span data-testid="board-sync-status" role="status" aria-label={status+(readOnly?' · 只读':'')} title={status+(readOnly?' · 只读':'')} className="flex min-w-0 max-w-44 items-center gap-2 whitespace-nowrap text-12 text-muted-foreground"><Cloud aria-hidden className="h-5 w-5 shrink-0"/><span className="hidden truncate md:inline">{status}{readOnly?' · 只读':''}</span></span>
  <div className="ml-auto flex shrink-0 items-center gap-2">{peers}<BoardShareDialog boardId={boardId}/>{presentation}<BoardToolPopover label="白板操作" trigger={<Button variant="ghost" size="icon" aria-label="更多白板操作" title="更多白板操作" className="min-h-11 min-w-11"><MoreHorizontal className="h-5 w-5"/></Button>}>{more}</BoardToolPopover></div>
 </header>;
}
