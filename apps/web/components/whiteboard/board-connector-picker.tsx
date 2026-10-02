'use client';
import type {ConnectorType} from '@repo/whiteboard-core';
import {Button} from '@/components/ui/button';
import {ConnectorToolPreview} from './board-connector-preview';
export function BoardConnectorPicker({value,disabled,onChange}:{value:ConnectorType;disabled:boolean;onChange:(value:ConnectorType)=>void}){
 return <div data-testid="board-connector-picker" role="group" aria-label="连接线路径" className="grid w-full min-w-0 grid-cols-3 gap-1">
  {([{value:'straight',label:'直线'},{value:'elbow',label:'折线'},{value:'curve',label:'曲线'}] as const).map(item=><Button key={item.value} data-testid={`board-connector-${item.value}`} aria-label={item.label} title={item.label} aria-pressed={value===item.value} disabled={disabled} variant={value===item.value?'secondary':'ghost'} className="min-h-11 min-w-11" onClick={()=>onChange(item.value)}><ConnectorToolPreview type={item.value}/></Button>)}
 </div>;
}
