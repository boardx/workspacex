'use client';
import {useEffect,useState,type RefObject} from 'react';
import type {BoardFitInsets} from './board-chrome-fit';
/** Measure visible chrome rather than reserving a permanently empty third row. */
export function useBoardChromeInsets(host:RefObject<HTMLElement|null>,selectionCount:number):BoardFitInsets{
 const [insets,setInsets]=useState<BoardFitInsets>({left:32,right:32,top:96,bottom:96});
 useEffect(()=>{
  const root=host.current;if(!root)return;
  const measure=()=>{
   const box=root.getBoundingClientRect();if(!box.width||!box.height)return;
   const header=root.querySelector('[data-testid="board-editor-header"]')?.getBoundingClientRect();
   const controls=[...root.querySelectorAll('[data-testid="board-creation-dock"]')].map(el=>el.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0);
   const selectionToolbar=selectionCount>0?root.querySelector('[data-testid="board-selection-layout-toolbar"],[data-testid="board-context-toolbar"]')?.getBoundingClientRect():undefined;
   const selectionSpace=selectionCount>0?(selectionToolbar?.height||54)+12:0;
   const next={left:Math.min(32,box.width/10),right:Math.min(32,box.width/10),top:Math.max(16,(header?.bottom??box.top)-box.top+16)+selectionSpace,bottom:Math.max(96,...controls.map(rect=>box.bottom-rect.top+12))};
   setInsets(previous=>Object.keys(next).every(key=>previous[key as keyof BoardFitInsets]===next[key as keyof BoardFitInsets])?previous:next);
  };
  measure();const observer=new ResizeObserver(measure);observer.observe(root);
  root.querySelectorAll('[data-testid="board-editor-header"],[data-testid="board-creation-dock"],[data-testid="board-selection-layout-toolbar"],[data-testid="board-context-toolbar"]').forEach(el=>observer.observe(el));
  return()=>observer.disconnect();
 },[host,selectionCount]);
 return insets;
}
