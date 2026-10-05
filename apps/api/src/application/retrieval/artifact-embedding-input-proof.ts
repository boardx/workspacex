import {createHash} from 'node:crypto';
export const artifactEmbeddingInputHash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** A service reference proves actor/source authority, not arbitrary request contents.
 * Accept only the canonical actual SDK embedding body and complete source text inputs.
 * Tokenized/transformed inputs need their own trusted lineage proof; never guess it. */
export function artifactEmbeddingInputMatchesSource(serializedBody:string,inputHashes:readonly string[]):boolean {
 if(!inputHashes.length||inputHashes.some(hash=>! /^[a-f0-9]{64}$/.test(hash)))return false;
 let body:Record<string,unknown>;
 try{const value:unknown=JSON.parse(serializedBody);if(!value||typeof value!=='object'||Array.isArray(value))return false;body=value as Record<string,unknown>;}
 catch{return false;}
 if(JSON.stringify(body)!==serializedBody||Object.keys(body).some(key=>!['model','input','encoding_format','dimensions'].includes(key))
  ||typeof body.model!=='string'||!body.model
  ||body.encoding_format!==undefined&&(typeof body.encoding_format!=='string'||!['base64','float'].includes(body.encoding_format))
  ||body.dimensions!==undefined&&(!Number.isSafeInteger(body.dimensions)||Number(body.dimensions)<=0))return false;
 const texts=typeof body.input==='string'?[body.input]:body.input;
 if(!Array.isArray(texts)||!texts.length||texts.some(text=>typeof text!=='string'||!text.length))return false;
 const allowed=new Set(inputHashes);
 return texts.every(text=>allowed.has(artifactEmbeddingInputHash(text)));
}
