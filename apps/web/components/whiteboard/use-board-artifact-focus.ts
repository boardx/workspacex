'use client';
import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { RenderedDiagramLayout } from '@repo/contracts/whiteboard-operation';
import { canonicalSceneBounds, type WhiteboardObject } from '@repo/whiteboard-core';
import type { BoardViewport } from './fabric/board-fabric-object';
import { fitBoardContent, type BoardFitInsets } from './board-chrome-fit';

export interface BoardArtifactFocusRequest { artifactId: string; layoutHash: string }
/** URL input identifies canonical content only; it never supplies position or size. */
export function readBoardArtifactFocus(search: Pick<URLSearchParams, 'getAll'> | null): BoardArtifactFocusRequest | null {
 const artifacts=search?.getAll('focusArtifact')??[],layouts=search?.getAll('focusLayout')??[];
 if(artifacts.length!==1||layouts.length!==1)return null;
 const artifact=RenderedDiagramLayout.shape.artifactId.safeParse(artifacts[0]);
 const layout=RenderedDiagramLayout.shape.layoutHash.safeParse(layouts[0]);
 return artifact.success&&layout.success?{artifactId:artifact.data,layoutHash:layout.data}:null;
}
export function artifactFocusBounds(request:BoardArtifactFocusRequest,objects:readonly WhiteboardObject[]){
 const visible=objects.filter(object=>!object.hidden).map(object=>{
  const value=object.extensionData?.content;
  const content=typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:null;
  return {object,content};
 });
 const mains=visible.filter(({content})=>content?.type==='artifact'&&content.artifactId===request.artifactId&&content.layoutHash===request.layoutHash);
 if(!mains.length)return null;
 const sources=new Set(mains.flatMap(({content})=>typeof content?.sourceId==='string'?[content.sourceId]:[]));
 const mainObjects=new Set(mains.map(({object})=>object));
 // Sequence helpers inherit provenance from their matched main source. They do
 // not carry layoutHash and must never activate focus or expand another layout.
 const bounds=visible.filter(({object,content})=>mainObjects.has(object)||(content?.type==='artifact-helper'&&content.artifactId===request.artifactId&&typeof content.sourceId==='string'&&sources.has(content.sourceId)))
  .map(({object})=>canonicalSceneBounds(object.geometry));
 if(!bounds.length)return null;
 return {left:Math.min(...bounds.map(value=>value.left)),top:Math.min(...bounds.map(value=>value.top)),right:Math.max(...bounds.map(value=>value.right)),bottom:Math.max(...bounds.map(value=>value.bottom))};
}
/** Register after persisted viewport restoration. Chrome measurement settles before
 * the one local fit; no selection, document mutation or persisted-view write is performed. */
export function useBoardArtifactFocus(request:BoardArtifactFocusRequest|null|undefined,objects:readonly WhiteboardObject[],host:RefObject<HTMLElement|null>,setViewport:Dispatch<SetStateAction<BoardViewport>>,insets:BoardFitInsets,scopeKey:string,ready=true){
 const consumed=useRef<string|null>(null);
 const requestKey=request?JSON.stringify([scopeKey,request.artifactId,request.layoutHash]):null;
 const bounds=request?artifactFocusBounds(request,objects):null;
 const boundsKey=bounds?JSON.stringify(bounds):null;
 useEffect(()=>{
  if(!ready||!requestKey||consumed.current===requestKey||!bounds)return;
  let active=true;
  const animation=requestAnimationFrame(()=>{
   if(!active||consumed.current===requestKey)return;
   const rect=host.current?.getBoundingClientRect();
   if(!rect||rect.width<=0||rect.height<=0)return;
   consumed.current=requestKey;
   const fitted=fitBoardContent(rect.width,rect.height,bounds,insets);
   setViewport(current=>({...current,...fitted}));
  });
  return()=>{active=false;cancelAnimationFrame(animation);};
 // Canonical objects may be re-read on viewport renders; only their target bounds
 // should reschedule an unconsumed focus intent.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[requestKey,boundsKey,host,setViewport,insets.left,insets.right,insets.top,insets.bottom,ready]);
}
