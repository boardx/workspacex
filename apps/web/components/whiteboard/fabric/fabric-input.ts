/** Fabric's default event mode emits MouseEvent OR TouchEvent, not always PointerEvent. */
type Contact = {identifier:number;clientX:number;clientY:number;force?:number};
type Input = {type?:string;clientX?:number;clientY?:number;pointerId?:number;pointerType?:string;isPrimary?:boolean;button?:number;pressure?:number;touches?:ArrayLike<Contact>;changedTouches?:ArrayLike<Contact>};
export type FabricInput = {id:string;x:number;y:number;pressure:number};
export function readFabricInput(event:Input|undefined,activeId?:string|null):FabricInput|null {
 if(!event||event.isPrimary===false)return null;
 let id:string,x:number|undefined,y:number|undefined,pressure:number|undefined;
 if(event.changedTouches||event.touches){
  const ending=event.type==='touchend'||event.type==='touchcancel';
  const contacts=Array.from(ending||event.type==='touchmove'&&event.changedTouches?.length?event.changedTouches??[]:event.touches??event.changedTouches??[]);
  const contact=activeId?contacts.find(t=>`touch:${t.identifier}`===activeId):contacts.length===1?contacts[0]:undefined;
  if(!contact)return null;
  id=`touch:${contact.identifier}`;x=contact.clientX;y=contact.clientY;pressure=contact.force;
 }else{
  if(event.button!==undefined&&event.type?.endsWith('down')&&event.button!==0)return null;
  id=event.pointerId===undefined?'mouse':`pointer:${event.pointerId}`;x=event.clientX;y=event.clientY;pressure=event.pressure;
 }
 if(activeId&&id!==activeId||!Number.isFinite(x)||!Number.isFinite(y))return null;
 return{id,x:x!,y:y!,pressure:Number.isFinite(pressure)?Math.max(0,Math.min(1,pressure!)):.5};
}
export function panFabricViewport(transform:readonly number[],previous:FabricInput,next:FabricInput):number[]|null {
 if(previous.id!==next.id||transform.length!==6||![...transform,previous.x,previous.y,next.x,next.y].every(Number.isFinite))return null;
 const value=[...transform];value[4]!+=next.x-previous.x;value[5]!+=next.y-previous.y;
 return value.every(Number.isFinite)?value:null;
}
