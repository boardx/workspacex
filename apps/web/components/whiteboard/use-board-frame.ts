"use client";
import {useLayoutEffect,useRef,useState} from 'react';
import type {BoardViewport} from './fabric/board-fabric-object';
export type BoardFrameSize={width:number;height:number};
export const boardFrameCenter=(frame:BoardFrameSize,viewport:Pick<BoardViewport,'panX'|'panY'|'zoom'>)=>({x:(frame.width/2-viewport.panX)/viewport.zoom,y:(frame.height/2-viewport.panY)/viewport.zoom});
export const followBoardFrame=(frame:BoardFrameSize,remote:{centerX:number;centerY:number;zoom:number})=>({zoom:remote.zoom,panX:frame.width/2-remote.centerX*remote.zoom,panY:frame.height/2-remote.centerY*remote.zoom});
/** The editor owns the available canvas area after sync banners and shell chrome. */
export function useBoardFrame(){
 const ref=useRef<HTMLElement>(null),[size,setSize]=useState<BoardFrameSize>({width:0,height:0});
 useLayoutEffect(()=>{
  const element=ref.current;if(!element)return;
  const measure=()=>{const rect=element.getBoundingClientRect();setSize(current=>current.width===rect.width&&current.height===rect.height?current:{width:rect.width,height:rect.height});};
  measure();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);observer?.observe(element);
  window.addEventListener('resize',measure);return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
 },[]);
 return{ref,size};
}
