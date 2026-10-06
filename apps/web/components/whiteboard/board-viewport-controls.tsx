'use client';
import {useState,type CSSProperties} from 'react';
import type {ReactNode} from 'react';
import {BoardSubmenuChevron} from './board-submenu-chevron';
import {Map,Maximize2,Minus,Plus,Scan} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
export function BoardViewportControls({zoom,onZoom,onFitBoard,onFitSelection,hasSelection,editing=false,minimap}:{zoom:number;onZoom:(zoom:number)=>void;onFitBoard:()=>void;onFitSelection:()=>void;hasSelection:boolean;editing?:boolean;minimap?:ReactNode}){
 const [mapOpen,setMapOpen]=useState(false),[zoomOpen,setZoomOpen]=useState(false);
 // Keep the 4px spacing rhythm stable when text alone grows to 400%.
 return <div style={{"--board-navigation-space":"4px"} as CSSProperties} className={`absolute bottom-[96px] right-[16px] z-30 flex max-w-[calc(100%_-_32px)] items-end gap-[calc(var(--board-navigation-space)*3)] max-sm:bottom-auto max-sm:top-[80px] xl:bottom-[20px] ${editing ? "max-sm:hidden" : ""}`}>
 {mapOpen&&minimap&&<div data-board-chrome="minimap" className="absolute bottom-full right-0 mb-3 max-w-full rounded-xl bg-card shadow-lg max-sm:bottom-auto max-sm:top-full max-sm:mb-0 max-sm:mt-3">{minimap}</div>}
 <div data-board-chrome="zoom" data-testid="board-navigation-controls" role="toolbar" aria-label="画布视图" className="grid min-w-0 max-w-full grid-cols-[44px_minmax(0,1fr)_44px] items-center rounded-xl border border-border-subtle bg-card p-[var(--board-navigation-space)] shadow-sm">
 <Button data-testid="board-overview-fit" variant="ghost" size="icon" className="h-[44px] min-h-[44px] w-[44px] min-w-[44px]" title="画布概览" aria-label="切换白板缩略图" aria-expanded={mapOpen} onClick={()=>setMapOpen(value=>!value)}><Map className="h-[16px] w-[16px] shrink-0"/></Button>
 <DropdownMenu open={zoomOpen} onOpenChange={setZoomOpen}><DropdownMenuTrigger asChild><Button data-testid="board-zoom-menu" variant="ghost" className="h-auto min-h-[44px] min-w-0 gap-[calc(var(--board-navigation-space)*2)] whitespace-normal px-[calc(var(--board-navigation-space)*2)]" aria-label="缩放菜单"><span data-testid="board-zoom-value" className="min-w-0 whitespace-normal break-all">{Math.round(zoom*100)}%</span><BoardSubmenuChevron open={zoomOpen} className="h-[16px] w-[16px]"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" side="top"><DropdownMenuItem data-testid="board-zoom-in" onSelect={()=>onZoom(zoom+.1)}><Plus className="h-[16px] w-[16px] shrink-0"/>放大</DropdownMenuItem><DropdownMenuItem data-testid="board-zoom-out" onSelect={()=>onZoom(zoom-.1)}><Minus className="h-[16px] w-[16px] shrink-0"/>缩小</DropdownMenuItem><DropdownMenuItem onSelect={()=>onZoom(1)}>实际大小 100%</DropdownMenuItem><DropdownMenuItem data-testid="board-zoom-fit-selection" disabled={!hasSelection} onSelect={onFitSelection}><Scan className="h-[16px] w-[16px] shrink-0"/>适应选择</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
 <Button variant="ghost" size="icon" title="适应白板 (1)" aria-label="适应白板" data-testid="board-zoom-fit-board" className="h-[44px] min-h-[44px] w-[44px] min-w-[44px]" onClick={onFitBoard}><Maximize2 className="h-[16px] w-[16px] shrink-0"/></Button></div></div>;
}
