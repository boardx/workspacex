import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ordered=objects=>[...objects].sort((a,b)=>a.id.localeCompare(b.id));

export function portableObjectExpectation(objects,requestId){
 const mapping=new Map(objects.map(object=>[object.id,`portable_${hash(`${requestId}:${object.id}`).slice(0,32)}`]));
 if(mapping.size!==objects.length)throw new Error('duplicate source identity');
 return objects.map(object=>{const copy={...structuredClone(object),id:mapping.get(object.id),parentId:object.parentId===null?null:mapping.get(object.parentId),...(object.connector?{connector:{...structuredClone(object.connector),...(object.connector.from?{from:mapping.get(object.connector.from)}:{}),...(object.connector.to?{to:mapping.get(object.connector.to)}:{})}}:{})};delete copy.restoredFrom;return copy;});
}

export function exactInterchangeObjects(expected,actual){
 if(!Array.isArray(actual)||new Set(actual.map(object=>object.id)).size!==actual.length||!isDeepStrictEqual(ordered(expected),ordered(actual)))throw new Error('interchange changed canonical objects');
 return true;
}

export function portableExportProof(exported,expectedObjects,revision){
 const bytes=Buffer.from(exported.contentBase64,'base64');
 if(bytes.length!==exported.sizeBytes||hash(bytes)!==exported.sha256)throw new Error('export byte identity changed');
 const bundle=JSON.parse(bytes.toString('utf8'));
 if(bundle.format!=='workspacex.board.bundle.v1'||!isDeepStrictEqual(bundle.revision,revision)||!isDeepStrictEqual(bundle.media,[]))throw new Error('export envelope changed');
 const objectBytes=Buffer.from(JSON.stringify(bundle.objects.content));
 if(bundle.objects.path!=='objects.json'||objectBytes.length!==bundle.objects.sizeBytes||hash(objectBytes)!==bundle.objects.sha256)throw new Error('objects byte identity changed');
 exactInterchangeObjects(expectedObjects,bundle.objects.content);
 return bundle;
}
