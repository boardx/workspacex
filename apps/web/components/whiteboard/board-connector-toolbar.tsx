'use client';
import {useEffect,useRef,useState} from 'react';
import {Check,Type,RotateCcw,AlignCenter,Minus,ChevronDown,ArrowLeftRight} from 'lucide-react';
import {WHITEBOARD_CONNECTOR_LIMITS,WhiteboardConnector} from '@repo/contracts/whiteboard-document';
import type {ConnectorLineStyle,ConnectorRelationship,ConnectorTip} from '@repo/whiteboard-core';
import {Button} from '@/components/ui/button';
import {BoardToolPopover} from './board-tool-popover';
import {BoardConnectorPicker} from './board-connector-picker';
import {ConnectorToolPreview} from './board-connector-preview';

export interface BoardConnectorToolbarProps{
 relationship:ConnectorRelationship;
 color:string;
 disabled:boolean;
 onRelationshipChange:(patch:Partial<ConnectorRelationship>)=>boolean|void;
 onColorChange:(color:string)=>void;
}
const tips:readonly ConnectorTip[]=['none','arrow','circle','diamond'];
const tipLabels:Record<ConnectorTip,string>={none:'无',arrow:'箭头',circle:'圆点',diamond:'菱形'};
const linePreview=(lineStyle:ConnectorLineStyle,color:string)=><span aria-hidden="true" data-connector-line-preview={lineStyle} className="block w-7 shrink-0" style={{borderTopWidth:2,borderTopStyle:lineStyle==='solid'?'solid':lineStyle==='dashed'?'dashed':'dotted',borderTopColor:color}}/>;

export function BoardConnectorToolbar({relationship,color,disabled,onRelationshipChange,onColorChange}:BoardConnectorToolbarProps){
 const [label,setLabel]=useState(relationship.label);
 const [labelBase,setLabelBase]=useState(relationship.label);
 const [labelError,setLabelError]=useState<string|null>(null);
 const composing=useRef(false);
 const labelConflict=labelBase!==relationship.label&&label!==relationship.label;
 const menuCue=<ChevronDown aria-hidden="true" className="pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5"/>;
 const [width,setWidth]=useState(String(relationship.strokeWidth??WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth));
 useEffect(()=>{if(label===labelBase){setLabel(relationship.label);setLabelBase(relationship.label);}else if(label===relationship.label)setLabelBase(relationship.label);},[label,labelBase,relationship.label]);
 useEffect(()=>setWidth(String(relationship.strokeWidth??WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth)),[relationship.strokeWidth]);
 const commitWidth=()=>{const value=Number(width);if(!disabled&&width.trim()&&Number.isFinite(value)&&value>=WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMin&&value<=WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMax&&value!==(relationship.strokeWidth??WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth))onRelationshipChange({strokeWidth:value});else setWidth(String(relationship.strokeWidth??WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth));};
 const commitLabel=()=>{
  if(disabled||composing.current)return;
  if(labelConflict){setLabelError('标签已被其他用户修改，您的草稿已保留。');return;}
  if(!WhiteboardConnector.safeParse({...relationship,label}).success){setLabelError('标签内容超出允许长度，草稿已保留。');return;}
  if(label!==relationship.label&&onRelationshipChange({label})===false){setLabelError('标签保存未被接受，草稿已保留。');return;}
  setLabelError(null);
 };
 return <div data-testid="board-connector-toolbar" role="toolbar" aria-label="连接线样式" className="flex w-max min-w-0 flex-nowrap items-center gap-0.5 [&>button]:relative [&>button]:shrink-0">
  <BoardToolPopover placement="above" label="连接线路径" trigger={<Button data-testid="board-connector-path-open" aria-label="连接线路径" title="连接线路径" size="icon" variant="ghost" className="h-11 w-11" disabled={disabled}><ConnectorToolPreview type={relationship.type} color={color}/>{menuCue}</Button>}>
   <BoardConnectorPicker value={relationship.type} disabled={disabled} onChange={type=>{if(type!==relationship.type)onRelationshipChange({type,route:undefined});}}/>
   <Button data-testid="board-connector-route-reset" aria-label="重置连接线路径" title="重置连接线路径" size="icon" variant="ghost" disabled={disabled||!relationship.route} onClick={()=>onRelationshipChange({route:undefined})}><RotateCcw className="h-4 w-4"/></Button>
  </BoardToolPopover>
  <label title="连接线颜色" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border"><input data-testid="board-connector-color" type="color" aria-label="连接线颜色" value={color} disabled={disabled} onChange={event=>onColorChange(event.target.value.toUpperCase())} className="h-7 w-7 cursor-pointer border-0 bg-transparent p-0"/></label>
  <BoardToolPopover placement="above" label="连接线粗细" trigger={<Button data-testid="board-connector-width-open" aria-label="连接线粗细" title="连接线粗细" size="icon" variant="ghost" className="h-11 w-11 gap-0.5" disabled={disabled}><Minus aria-hidden="true" className="h-4 w-4" strokeWidth={Math.min(6,relationship.strokeWidth??WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth)}/><span className="text-10 tabular-nums">{relationship.strokeWidth??WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth}</span>{menuCue}</Button>}>
   <div className="flex items-center gap-3"><input data-testid="board-connector-width" type="number" aria-label="连接线粗细数值" title="连接线粗细" min={WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMin} max={WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMax} step="1" value={width} disabled={disabled} onChange={event=>setWidth(event.target.value)} onBlur={commitWidth} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='Enter')event.currentTarget.blur();else if(event.key==='Escape'){event.stopPropagation();setWidth(String(relationship.strokeWidth??WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth));}}} className="h-11 w-20 rounded-lg border border-input bg-card px-2 text-13"/><span aria-hidden="true" className="min-w-0 flex-1 rounded-full bg-foreground" style={{height:Math.max(1,Math.min(24,Number(width)||2))}}/></div>
   <div className="mt-3 grid grid-cols-3 gap-1">{[WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMin,2,4,8,12,WHITEBOARD_CONNECTOR_LIMITS.strokeWidthMax].map(value=><Button key={value} data-testid={`board-connector-width-${value}`} aria-label={`${value} px`} title={`${value} px`} variant={relationship.strokeWidth===value?'secondary':'ghost'} disabled={disabled} onPointerDown={event=>{if(event.button===0)event.preventDefault();}} onClick={()=>{setWidth(String(value));if(value!==(relationship.strokeWidth??WHITEBOARD_CONNECTOR_LIMITS.defaultStrokeWidth))onRelationshipChange({strokeWidth:value});}}><span aria-hidden="true" className="w-10 rounded-full bg-foreground" style={{height:value}}/></Button>)}</div>
  </BoardToolPopover>
  <span aria-hidden="true" className="mx-1 h-5 shrink-0 border-l border-border"/>
  <BoardToolPopover placement="above" label="连接线型" trigger={<Button data-testid="board-connector-pattern-open" aria-label="连接线型" title="连接线型" size="icon" variant="ghost" className="h-11 w-11" disabled={disabled}>{linePreview(relationship.lineStyle,color)}{menuCue}</Button>}>
   <div className="grid grid-cols-3 gap-1">{(['solid','dashed','dotted'] as const).map((lineStyle:ConnectorLineStyle)=><Button key={lineStyle} data-testid={`board-connector-pattern-${lineStyle}`} aria-label={({solid:'实线',dashed:'虚线',dotted:'点线'})[lineStyle]} title={({solid:'实线',dashed:'虚线',dotted:'点线'})[lineStyle]} aria-pressed={relationship.lineStyle===lineStyle} variant={relationship.lineStyle===lineStyle?'secondary':'ghost'} disabled={disabled} onClick={()=>onRelationshipChange({lineStyle})}>{linePreview(lineStyle,color)}</Button>)}</div>
  </BoardToolPopover>
  <BoardToolPopover placement="above" label="端点样式" trigger={<Button data-testid="board-connector-endpoints-open" aria-label="端点样式" title="端点样式" size="icon" variant="ghost" className="h-11 w-11" disabled={disabled}><ArrowLeftRight className="h-5 w-5"/>{menuCue}</Button>}>
   <div className="space-y-3">{(['start','end'] as const).map(end=><section key={end} role="group" aria-label={end==='start'?'连接起点':'连接终点'}><h3 className="mb-1 text-12 font-medium">{end==='start'?'起点':'终点'}</h3><div className="grid grid-cols-4 gap-1">{tips.map(tip=><Button key={tip} data-testid={`board-connector-${end}-${tip}`} aria-label={tipLabels[tip]} title={tipLabels[tip]} aria-pressed={(end==='start'?relationship.startStyle:relationship.endStyle)===tip} variant={(end==='start'?relationship.startStyle:relationship.endStyle)===tip?'secondary':'ghost'} disabled={disabled} onClick={()=>onRelationshipChange(end==='start'?{startStyle:tip}:{endStyle:tip})}><ConnectorToolPreview type="straight" color={color} startStyle={end==='start'?tip:'none'} endStyle={end==='end'?tip:'none'}/></Button>)}</div></section>)}</div>
  </BoardToolPopover>
  <span aria-hidden="true" className="mx-1 h-5 shrink-0 border-l border-border"/>
  <BoardToolPopover placement="above" label="连接标签" onEscapeKeyDown={event=>{if(event.isComposing||composing.current)event.preventDefault();}} trigger={<Button data-testid="board-connector-label-open" aria-label="连接标签" title="连接标签" size="icon" variant="ghost" className="h-11 w-11" disabled={disabled}><Type className="h-4 w-4"/>{menuCue}</Button>}>
   <form onSubmit={event=>{event.preventDefault();commitLabel();}} className="space-y-2"><textarea data-testid="board-connector-label" aria-label="连接标签" value={label} disabled={disabled} onChange={event=>{setLabel(event.target.value);setLabelError(null);}} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{if(event.nativeEvent.isComposing||composing.current){if(event.key==='Escape')event.stopPropagation();return;}if(event.key==='Escape'){event.stopPropagation();setLabel(relationship.label);setLabelBase(relationship.label);setLabelError(null);}}} className="min-h-24 w-full resize-y rounded-lg border border-input bg-card p-2 text-13"/>{labelConflict||labelError?<p role="alert" className="text-12 text-destructive">{labelError??'标签已被其他用户修改，您的草稿已保留。'}</p>:null}<div className="flex gap-1"><Button type="submit" data-testid="board-connector-label-save" aria-label="保存连接标签" title="保存连接标签" size="icon" disabled={disabled||label===relationship.label}><Check className="h-4 w-4"/></Button>{labelConflict?<Button type="button" data-testid="board-connector-label-reload" aria-label="放弃草稿并载入最新标签" title="放弃草稿并载入最新标签" size="icon" variant="ghost" disabled={disabled} onClick={()=>{setLabel(relationship.label);setLabelBase(relationship.label);setLabelError(null);}}><RotateCcw className="h-4 w-4"/></Button>:null}<Button type="button" data-testid="board-connector-label-center" aria-label="标签沿路径居中" title="标签沿路径居中" size="icon" variant="ghost" disabled={disabled||!relationship.label.trim()} onClick={()=>onRelationshipChange({labelPosition:{t:.5,normalOffset:0}})}><AlignCenter className="h-4 w-4"/></Button></div></form>
  </BoardToolPopover>
 </div>;
}
