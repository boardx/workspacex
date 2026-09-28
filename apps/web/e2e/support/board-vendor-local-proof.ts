import {strict as assert} from 'node:assert';
import type {WhiteboardObject} from '@repo/contracts/whiteboard-document';

export type VendorLocalObject={id:string;kind:string;text:string;geometry:WhiteboardObject['geometry'];parentId:string|null;zIndex:number;from:string|null;to:string|null;start:{x:number;y:number}|null;end:{x:number;y:number}|null};
const labels:Record<string,string>={sticky:'便利贴',text:'文字',rectangle:'矩形',ellipse:'椭圆',shape:'形状',drawing:'绘图',image:'图片',card:'结构化卡片',panel:'区域',group:'组合',connector:'连接线'};
function kind(object:WhiteboardObject):string{
 const content=object.extensionData?.contentObject as {type?:string}|undefined;
 return content?.type==='shape'?'shape':content?.type==='image'?'image':content?.type==='drawing'?'drawing':content?'card':object.kind==='frame'?'panel':object.kind;
}
function endpoint(object:WhiteboardObject,anchor:string){
 const {x,y,width,height,rotation}=object.geometry;
 const offset:Record<string,[number,number]>={left:[0,height/2],right:[width,height/2],top:[width/2,0],bottom:[width/2,height],center:[width/2,height/2]};
 assert(offset[anchor],`unknown connector anchor ${anchor}`);const [dx,dy]=offset[anchor]!,r=rotation*Math.PI/180;
 // Canonical rotation is around the unrotated top-left, not the center.
 const stable=(value:number)=>Math.abs(value)<1e-10?0:Math.round(value*1e12)/1e12;
 return{x:stable(x+dx*Math.cos(r)-dy*Math.sin(r)),y:stable(y+dx*Math.sin(r)+dy*Math.cos(r))};
}
/** Independent observable projection expectation, not the production Fabric adapter.
 * The mirror exposes canonical geometry/text/relationships, not every style field.
 * Full persisted fields are compared separately by assertPortableCanonicalRoundtrip. */
export function expectedVendorLocalObjects(objects:readonly WhiteboardObject[]):VendorLocalObject[]{
 const byId=new Map(objects.map(o=>[o.id,o]));assert.equal(byId.size,objects.length);
 return objects.map(o=>{const c=o.connector,k=kind(o);assert(labels[k],`unsupported local kind ${k}`);
  const point=(side:'from'|'to')=>{if(!c)return null;const id=c[side];if(id){const target=byId.get(id);assert(target,`missing endpoint ${id}`);return endpoint(target,c[side==='from'?'fromAnchor':'toAnchor']??(side==='from'?'right':'left'));}return c[side==='from'?'fromPoint':'toPoint']??null;};
  return{id:o.id,kind:k,text:o.text||labels[k]!,geometry:o.geometry,parentId:o.parentId??null,zIndex:o.zIndex??0,from:c?.from??null,to:c?.to??null,start:point('from'),end:point('to')};
 }).sort((a,b)=>a.id.localeCompare(b.id));
}
export function assertVendorLocalObjects(actual:VendorLocalObject[],expected:readonly WhiteboardObject[]){
 assert.equal(new Set(actual.map(o=>o.id)).size,actual.length,'duplicate local object');
 assert.deepEqual([...actual].sort((a,b)=>a.id.localeCompare(b.id)),expectedVendorLocalObjects(expected));
}
function sourceId(object:WhiteboardObject){const imported=object.extensionData?.import as {sourceId?:unknown}|undefined;assert.equal(typeof imported?.sourceId,'string','missing source identity');return imported!.sourceId as string;}
/** IDs are deliberately rebound on import; all other persisted fields must survive. */
export function assertPortableCanonicalRoundtrip(source:readonly WhiteboardObject[],target:readonly WhiteboardObject[]){
 const normalize=(objects:readonly WhiteboardObject[])=>{const ids=new Map(objects.map(o=>[o.id,sourceId(o)]));assert.equal(ids.size,objects.length);assert.equal(new Set(ids.values()).size,objects.length,'duplicate source identity');
  const ref=(id:string)=>{assert(ids.has(id),`dangling canonical reference ${id}`);return ids.get(id)!;};
  return objects.map(original=>{const o=structuredClone(original);o.id=ref(o.id);o.parentId=o.parentId?ref(o.parentId):null;if(o.connector){if(o.connector.from)o.connector.from=ref(o.connector.from);if(o.connector.to)o.connector.to=ref(o.connector.to);}return o;}).sort((a,b)=>a.id.localeCompare(b.id));
 };
 assert.equal(target.length,source.length);assert(source.every(o=>!target.some(t=>t.id===o.id)),'portable target reused source object identity');
 assert.deepEqual(normalize(target),normalize(source));
}

/** Serializable browser callback; every field comes from the live DOM. */
export const readVendorLocalNodes=(nodes:Element[]):VendorLocalObject[]=>nodes.map(node=>{
  const required=(name:string)=>{const value=node.getAttribute(name);if(value===null)throw new Error(`Missing local ${name}`);return value;};
  const point=(name:string)=>{const value=node.getAttribute(name);return value?JSON.parse(value):null;};
  const label=node.querySelector('button')?.getAttribute('aria-label');if(!label?.startsWith('图形：'))throw new Error('Missing local object text');
  return{id:required('data-object-id'),kind:required('data-object-kind'),text:label.slice(3),geometry:JSON.parse(required('data-geometry')),parentId:required('data-parent-id')||null,zIndex:Number(required('data-z-index')),from:required('data-connector-from')||null,to:required('data-connector-to')||null,start:point('data-connector-start'),end:point('data-connector-end')};
 }).sort((a,b)=>a.id.localeCompare(b.id));
