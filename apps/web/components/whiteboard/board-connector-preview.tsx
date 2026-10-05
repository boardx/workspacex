import {useId} from 'react';
import type {ConnectorLineStyle,ConnectorTip,ConnectorType} from '@repo/whiteboard-core';

export function ConnectorToolPreview({type,color='currentColor',width=2,lineStyle='solid',startStyle='none',endStyle='arrow'}:{type:ConnectorType;color?:string;width?:number;lineStyle?:ConnectorLineStyle;startStyle?:ConnectorTip;endStyle?:ConnectorTip}){
 const id=useId().replace(/:/g,'');
 const tip=(style:ConnectorTip)=>style==='arrow'?<path d="M 0 0 L 8 4 L 0 8 Z"/>:style==='circle'?<circle cx="4" cy="4" r="3"/>:style==='diamond'?<path d="M 4 0 L 8 4 L 4 8 L 0 4 Z"/>:null;
 const path=type==='free'?'M 5 25 C 2 6, 18 3, 20 17 S 31 29, 35 9':type==='curve'?'M 5 25 C 5 4, 35 30, 35 9':type==='elbow'?'M 5 25 L 20 25 L 20 9 L 35 9':'M 5 25 L 35 9';
 return <svg aria-hidden="true" data-connector-preview={type} viewBox="0 0 40 34" className="h-7 w-8 shrink-0" fill="none">
  <defs>{(['start','end'] as const).map(end=>{const style=end==='start'?startStyle:endStyle;return style==='none'?null:<marker key={end} id={`${id}-${end}`} markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse" fill={color}>{tip(style)}</marker>;})}</defs>
  <path data-connector-path="true" d={path} stroke={color} strokeWidth={width} strokeDasharray={lineStyle==='dashed'?'6 4':lineStyle==='dotted'?'1 4':undefined} strokeLinecap="round" markerStart={startStyle==='none'?undefined:`url(#${id}-start)`} markerEnd={endStyle==='none'?undefined:`url(#${id}-end)`}/>
 </svg>;
}
