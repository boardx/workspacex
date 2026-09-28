'use client';
import {ChevronDown,Map,Maximize2,Minus,Plus,Scan} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
export function BoardViewportControls({zoom,onZoom,onFitBoard,onFitSelection,hasSelection,editing=false}:{zoom:number;onZoom:(zoom:number)=>void;onFitBoard:()=>void;onFitSelection:()=>void;hasSelection:boolean;editing?:boolean}){
 return <div className={`absolute bottom-24 right-4 z-30 flex items-end gap-3 xl:bottom-5 ${editing ? "max-sm:hidden" : ""}`}>
 <div data-board-chrome="zoom" data-testid="board-navigation-controls" role="toolbar" aria-label="画布视图" className="flex items-center rounded-xl border border-border-subtle bg-card p-1 shadow-sm">
 <Button data-testid="board-overview-fit" variant="ghost" size="icon" className="min-h-11 min-w-11" title="画布概览" aria-label="画布概览：显示全部内容" onClick={onFitBoard}><Map className="h-4 w-4"/></Button><span className="h-6 w-px bg-border"/>
 <DropdownMenu><DropdownMenuTrigger asChild><Button data-testid="board-zoom-menu" variant="ghost" className="min-h-11 gap-2" aria-label="缩放菜单"><span data-testid="board-zoom-value">{Math.round(zoom*100)}%</span><ChevronDown className="h-4 w-4"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem data-testid="board-zoom-in" onSelect={()=>onZoom(zoom+.1)}><Plus className="h-4 w-4"/>放大</DropdownMenuItem><DropdownMenuItem data-testid="board-zoom-out" onSelect={()=>onZoom(zoom-.1)}><Minus className="h-4 w-4"/>缩小</DropdownMenuItem><DropdownMenuItem onSelect={()=>onZoom(1)}>实际大小 100%</DropdownMenuItem><DropdownMenuItem data-testid="board-zoom-fit-selection" disabled={!hasSelection} onSelect={onFitSelection}><Scan className="h-4 w-4"/>适应选择</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
 <span className="h-6 w-px bg-border"/><Button variant="ghost" size="icon" title="适应白板 (1)" aria-label="适应白板" data-testid="board-zoom-fit-board" className="min-h-11 min-w-11" onClick={onFitBoard}><Maximize2 className="h-4 w-4"/></Button></div></div>;
}
