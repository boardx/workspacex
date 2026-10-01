import type {WhiteboardObject} from '@repo/contracts/whiteboard-document';
import type {BoardFabricObject} from './fabric/board-fabric-object';
/** Select the same projected objects as the canvas, once per containment root.
 * Hidden ancestry must not expose a descendant; locked roots remain inspectable. */
export function boardSelectAllIds(objects:readonly WhiteboardObject[],projected:readonly BoardFabricObject[]):string[]{
 const byId=new Map(objects.map(object=>[object.id,object]));
 const available=new Set(projected.filter(object=>object.kind!=='placeholder').map(object=>object.id));
 const visible=objects.filter(object=>{
  if(!available.has(object.id))return false;
  const seen=new Set<string>();let current:WhiteboardObject|undefined=object;
  while(current){if(current.hidden||seen.has(current.id))return false;seen.add(current.id);current=current.parentId?byId.get(current.parentId):undefined;}
  return true;
 });
 const visibleIds=new Set(visible.map(object=>object.id));
 return visible.filter(object=>{
  let parent=object.parentId?byId.get(object.parentId):undefined;
  while(parent){if(visibleIds.has(parent.id))return false;parent=parent.parentId?byId.get(parent.parentId):undefined;}
  return true;
 }).map(object=>object.id);
}
