'use client';
import {useCallback,useEffect,useRef,type Dispatch,type RefObject,type SetStateAction} from 'react';
import type {WhiteboardAIProposal} from '@repo/contracts/whiteboard-operation';
import type {WhiteboardObject} from '@repo/whiteboard-core';
import {type BoardViewport} from './fabric/board-fabric-object';

import {fitBoardContent,type BoardFitInsets} from './board-chrome-fit';

/** Local confirmation intent only; never derived from shared document events. */
export interface BoardOrganizeFitRequest {id:string;proposal:WhiteboardAIProposal}
export function organizeFitBounds(request:BoardOrganizeFitRequest,objects:readonly WhiteboardObject[]){
  const expected=request.proposal.action.commands.flatMap(command=>command.type==='create'?[{id:command.object.id,geometry:command.object.geometry}]:command.type==='geometry'?[command]:[]);
  if(!expected.length)return null;
  const found=expected.map(item=>objects.find(object=>object.id===item.id));
  if(found.some((object,index)=>!object||Object.entries(expected[index]!.geometry).some(([key,value])=>object.geometry[key as keyof typeof object.geometry]!==value)))return null;
  const geometry=found.map(object=>object!.geometry);
  return {left:Math.min(...geometry.map(item=>item.x)),top:Math.min(...geometry.map(item=>item.y)),right:Math.max(...geometry.map(item=>item.x+item.width)),bottom:Math.max(...geometry.map(item=>item.y+item.height))};
}
export function useBoardOrganizeFit(request:BoardOrganizeFitRequest|null|undefined,objects:readonly WhiteboardObject[],host:RefObject<HTMLDivElement|null>,setViewport:Dispatch<SetStateAction<BoardViewport>>,insets:BoardFitInsets={left:32,right:32,top:96,bottom:128}){
  const consumed=useRef<string|null>(null),animation=useRef<number|null>(null);
  const cancel=useCallback(()=>{if(animation.current!==null)cancelAnimationFrame(animation.current);animation.current=null;if(request)consumed.current=request.id;},[request]);
  const bounds=request?organizeFitBounds(request,objects):null;
  const boundsKey=bounds?`${bounds.left}:${bounds.top}:${bounds.right}:${bounds.bottom}`:null;
  useEffect(()=>{
    if(!request||consumed.current===request.id)return;
    const rect=host.current?.getBoundingClientRect();
    if(!bounds||!rect||rect.width<=0||rect.height<=0)return;
    consumed.current=request.id;
    const target=fitBoardContent(rect.width,rect.height,bounds,insets);
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){setViewport(value=>({...value,...target}));return;}
    let start:BoardViewport|undefined;const started=performance.now();
    const tick=(now:number)=>{const progress=Math.min(1,(now-started)/240),eased=1-(1-progress)**3;setViewport(value=>{start??=value;return {...value,zoom:start.zoom+(target.zoom-start.zoom)*eased,panX:start.panX+(target.panX-start.panX)*eased,panY:start.panY+(target.panY-start.panY)*eased};});if(progress<1)animation.current=requestAnimationFrame(tick);else animation.current=null;};
    animation.current=requestAnimationFrame(tick);
    return()=>{if(animation.current!==null)cancelAnimationFrame(animation.current);animation.current=null;};
  // readObjects returns a new array on viewport renders; depend on canonical geometry,
  // otherwise the first animation frame would cancel its own remaining frames.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[request,boundsKey,host,setViewport,insets.left,insets.right,insets.top,insets.bottom]);
  return cancel;
}
