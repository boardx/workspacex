import {describe,it,expect} from 'vitest';
import type {WhiteboardObject} from '@repo/contracts/whiteboard-document';
import {assertVendorLocalObjects,assertPortableCanonicalRoundtrip,expectedVendorLocalObjects} from '../../e2e/support/board-vendor-local-proof';
const object=(id:string,kind:WhiteboardObject['kind']='sticky'):WhiteboardObject=>({id,schemaVersion:1,kind,text:`中文 ${id}`,geometry:{x:10,y:20,width:100,height:80,rotation:0},style:{fill:'#ABCDEF'},parentId:null,orderKey:id,zIndex:2,extensionData:{import:{sourceId:id}}});
const source:WhiteboardObject[]=[object('frame','frame'),{...object('note'),parentId:'frame'},object('peer'),{...object('edge','connector'),connector:{from:'note',to:'peer',type:'straight',label:'中文 edge',endStyle:'arrow'}}];
function target(){return source.map(o=>({...structuredClone(o),id:`new-${o.id}`,parentId:o.parentId?`new-${o.parentId}`:null,...(o.connector?{connector:{...o.connector,from:`new-${o.connector.from}`,to:`new-${o.connector.to}`}}:{})}));}
describe('vendor local browser proof counterexamples',()=>{
 it('compares the complete local inventory with explicit geometry, label, hierarchy and endpoints',()=>{
  const actual=expectedVendorLocalObjects(source);expect(()=>assertVendorLocalObjects(actual,source)).not.toThrow();
  expect(actual.find(o=>o.id==='edge')?.start).toEqual({x:110,y:60});expect(actual.find(o=>o.id==='edge')?.end).toEqual({x:10,y:60});
  expect(actual.find(o=>o.id==='frame')?.kind).toBe('panel');
 });
 it.each(['missing','extra','duplicate','geometry','text','parent','zIndex','from','end','kind'])('rejects stale/misprojected browser state: %s',field=>{
  const actual=expectedVendorLocalObjects(source),note=actual.find(o=>o.id==='note')!,edge=actual.find(o=>o.id==='edge')!;
  if(field==='missing')actual.pop();if(field==='extra')actual.push({...note,id:'extra'});if(field==='duplicate')actual.push(structuredClone(note));
  if(field==='geometry')note.geometry={...note.geometry,x:999};if(field==='text')note.text='STALE';if(field==='parent')note.parentId=null;if(field==='zIndex')note.zIndex=99;if(field==='from')edge.from='peer';if(field==='end')edge.end={x:999,y:0};if(field==='kind')note.kind='placeholder';
  expect(()=>assertVendorLocalObjects(actual,source)).toThrow();
 });
 it('keeps rotated anchor geometry independently calculated',()=>{
  const rotated=structuredClone(source);rotated[1]!.geometry.rotation=90;
  expect(expectedVendorLocalObjects(rotated).find(o=>o.id==='edge')?.start).toEqual({x:-30,y:120});
 });
});
describe('portable complete canonical comparison',()=>{
 it('accepts only ID rebinding while preserving source identities and complete fields',()=>expect(()=>assertPortableCanonicalRoundtrip(source,target())).not.toThrow());
 it.each(['style','text','parent','connector','missing','extra','oldId','sourceIdentity'])('rejects lossy roundtrip: %s',field=>{
  const changed=target();if(field==='style')changed[1]!.style.fill='#000000';if(field==='text')changed[1]!.text='';if(field==='parent')changed[1]!.parentId=null;if(field==='connector')changed[3]!.connector!.from='new-peer';if(field==='missing')changed.pop();if(field==='extra')changed.push({...object('extra'),id:'new-extra'});if(field==='oldId')changed[0]!.id='frame';if(field==='sourceIdentity')changed[1]!.extensionData={import:{sourceId:'peer'}};
  expect(()=>assertPortableCanonicalRoundtrip(source,changed)).toThrow();
 });
});
