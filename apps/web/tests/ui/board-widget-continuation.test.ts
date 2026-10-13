import {expect,it} from 'vitest';
import type {WhiteboardObject} from '@repo/whiteboard-core';
import {boardWidgetContinuation} from '@/components/whiteboard/board-widget-continuation';
const source:WhiteboardObject={id:'source',schemaVersion:1,kind:'rectangle',geometry:{x:100,y:200,width:80,height:70,rotation:0},text:'same type',style:{fill:'#22c55e'},parentId:null,orderKey:'source'};
it('creates an adjacent matching widget and edge as one command batch without mutating its source',()=>{
 const before=structuredClone(source),result=boardWidgetContinuation([source],'source','next','edge')!;
 expect(result.widgetId).toBe('next');expect(result.commands).toHaveLength(2);
 expect(result.commands[0]).toEqual({type:'create',object:{...source,id:'next',locked:false,geometry:{...source.geometry,x:204}}});
 expect(result.commands[1]).toMatchObject({type:'create',object:{id:'edge',kind:'connector',connector:{from:'source',to:'next',fromAnchor:'right',toAnchor:'left',endStyle:'arrow'}}});expect(source).toEqual(before);
});
it('keeps existing connection appearance while deriving fresh anchors and excluding endpoint-specific routes',()=>{
 const edge:WhiteboardObject={...source,id:'old-edge',kind:'connector',style:{stroke:'#e11d48'},connector:{from:'source',to:'old-target',type:'curve',startStyle:'circle',endStyle:'diamond',lineStyle:'dashed',label:'old label',route:{kind:'curve',startOffset:{x:1,y:2},endOffset:{x:3,y:4}}}};
 const result=boardWidgetContinuation([source,edge],'source','next','edge')!;
 expect(result.commands[1]).toMatchObject({object:{style:edge.style,connector:{type:'curve',startStyle:'circle',endStyle:'diamond',lineStyle:'dashed',label:''}}});
 expect(result.commands[1].type==='create'&&result.commands[1].object.connector?.route).toBeUndefined();
});
it('rejects locked or hidden ancestors, groups and connector selections',()=>{
 const parent={...source,id:'parent',kind:'group' as const,locked:true};
 expect(boardWidgetContinuation([{...source,parentId:'parent'},parent],'source','next','edge')).toBeNull();
 for(const item of [{...source,locked:true},{...source,hidden:true},{...source,kind:'group' as const},{...source,kind:'connector' as const}])expect(boardWidgetContinuation([item],'source','next','edge')).toBeNull();
});
