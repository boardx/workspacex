import {it,expect} from 'vitest';
import {createWhiteboardDocument,executeCommands,readObjects,SpatialRelationshipCommandPort,type ConnectorRelationship,type WhiteboardObject} from '../src';
const object=(id:string,x:number):WhiteboardObject=>({id,schemaVersion:1,kind:'rectangle',geometry:{x,y:20,width:100,height:80,rotation:0},text:id,style:{},parentId:null,orderKey:id});
const relationship:ConnectorRelationship={from:'a',to:'b',fromAnchor:'bottom',toAnchor:'bottom',fromOffset:{x:0,y:100},toOffset:{x:0,y:100},type:'straight',startStyle:'none',endStyle:'arrow',lineStyle:'solid',label:'message',semanticRelation:''};
it('preserves local time offsets through spatial rotation, resize, style and detach',()=>{
 const doc=createWhiteboardDocument(),a=object('a',10);a.geometry.rotation=90;
 executeCommands(doc,[{type:'create',object:a},{type:'create',object:object('b',300)}],{});
 const port=new SpatialRelationshipCommandPort(doc);let sequence=0;
 const dispatch=(command:Parameters<typeof port.dispatch>[0]['command'])=>port.dispatch({boardId:'board',clientId:'client',gestureId:`g${sequence++}`,command});
 dispatch({type:'create-connector',id:'edge',relationship});
 expect(readObjects(doc).find(o=>o.id==='edge')!.geometry).toMatchObject({x:-170,y:70,width:520,height:130});
 dispatch({type:'transform',items:[{id:'a',geometry:{x:200,y:100,width:200,height:100,rotation:180}}]});
 expect(readObjects(doc).find(o=>o.id==='edge')!.geometry).toMatchObject({x:100,y:-100,width:250,height:300});
 dispatch({type:'update-connector',id:'edge',relationship:{...relationship,lineStyle:'dotted'}});
 expect(readObjects(doc).find(o=>o.id==='edge')!.connector).toMatchObject({fromOffset:{x:0,y:100},toOffset:{x:0,y:100},lineStyle:'dotted'});
 dispatch({type:'delete-object',id:'a',connectors:'preserve-free'});
 const edge=readObjects(doc).find(o=>o.id==='edge')!;
 expect(edge.connector).toMatchObject({fromPoint:{x:100,y:-100},to:'b',toOffset:{x:0,y:100}});expect(edge.connector?.fromOffset).toBeUndefined();doc.destroy();
});
it('allows explicit separated self-message attachments without admitting collapsed ordinary self edges',()=>{
 const doc=createWhiteboardDocument();executeCommands(doc,[{type:'create',object:object('a',0)}],{});
 const port=new SpatialRelationshipCommandPort(doc);
 expect(()=>port.dispatch({boardId:'b',clientId:'c',gestureId:'bad',command:{type:'create-connector',id:'bad',relationship:{...relationship,to:'a',fromOffset:undefined,toOffset:undefined}}})).toThrow('CONNECTOR_ENDPOINT_INVALID');
 port.dispatch({boardId:'b',clientId:'c',gestureId:'self',command:{type:'create-connector',id:'loop',relationship:{...relationship,to:'a',toOffset:{x:56,y:128},type:'elbow'}}});
 expect(readObjects(doc).find(o=>o.id==='loop')!.geometry).toMatchObject({x:50,y:200,width:56,height:28});doc.destroy();
});
