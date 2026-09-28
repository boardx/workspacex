import * as Y from 'yjs';
import type {WhiteboardObject} from '@repo/contracts/whiteboard-document';
import {objectMap,readObjects,tombstones,validateDocument} from './document';

/** Server-only compensation of a trusted immutable before-image. The caller must
 * own a disposable worker document and enforce actor/revision/receipt checks.
 * This is deliberately not a client command or a raw-Yjs validation exception. */
export function compensateWhiteboardSnapshot(doc:Y.Doc,before:readonly WhiteboardObject[]):string[]{
 const current=new Map(readObjects(doc).map(object=>[object.id,object])),desired=new Map(before.map(object=>[object.id,object]));
 if(desired.size!==before.length)throw new Error('DUPLICATE_BEFORE_OBJECT');
 const changed=[...new Set([...current.keys(),...desired.keys()])].filter(id=>JSON.stringify(current.get(id)??null)!==JSON.stringify(desired.get(id)??null));
 doc.transact(()=>{
  for(const id of changed){
   const target=desired.get(id);
   if(!target){tombstones(doc).set(id,true);continue;}
   const value=objectMap(doc).get(id);
   if(!value||value.get('kind')!==target.kind||value.get('schemaVersion')!==target.schemaVersion)throw new Error('BEFORE_IDENTITY_MISSING');
   tombstones(doc).delete(id);
   for(const key of [...value.keys()])if(!['text','style'].includes(key)&&!(key in target))value.delete(key);
   for(const [key,field]of Object.entries(target))if(!['id','text','style'].includes(key))value.set(key,structuredClone(field));
   const text=value.get('text');if(!(text instanceof Y.Text))throw new Error('TEXT_IDENTITY_MISSING');
   if(text.toString()!==target.text){text.delete(0,text.length);text.insert(0,target.text);}
   const style=value.get('style');if(!(style instanceof Y.Map))throw new Error('STYLE_IDENTITY_MISSING');
   for(const key of [...style.keys()])if(!(key in target.style))style.delete(key);
   for(const[key,field]of Object.entries(target.style))style.set(key,structuredClone(field));
  }
 },'server-operation-compensation');
 validateDocument(doc);return changed;
}
