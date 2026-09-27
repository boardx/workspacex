import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import type {APIRequestContext} from '@playwright/test';
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
/** Executes only when called by the real isolated acceptance lane. Does not start services.
 * sourceBoard must be a disposable migration fixture with hierarchy, connector and an image.
 * source/target URLs and tokens may name different instances and tenants.
 */
export async function producePortableRoundtripEvidence(input:{api:APIRequestContext;sourceUrl:string;targetUrl:string;sourceToken:string;targetToken:string;sourceBoardId:string}){
 const call=async(url:string,token:string,method:string,path:string,data?:unknown)=>{const response=await input.api.fetch(`${url}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});assert(response.ok(),`${method} ${path}: ${response.status()} ${await response.text()}`);return response;};
 const exported=await(await call(input.sourceUrl,input.sourceToken,'POST',`/whiteboards/${input.sourceBoardId}/portable/export`,{})).json(),bytes=Buffer.from(exported.contentBase64,'base64');assert.equal(digest(bytes),exported.sha256);assert.equal(bytes.length,exported.sizeBytes);
 const bundle=JSON.parse(bytes.toString());assert(bundle.objects.content.some((object:any)=>object.parentId),'fixture needs hierarchy');assert(bundle.objects.content.some((object:any)=>object.connector),'fixture needs connector');assert(bundle.media.length>0,'fixture needs real images');assert(!bytes.toString().includes('whiteboards/tenants/'));
 const target=await(await call(input.targetUrl,input.targetToken,'POST','/whiteboards',{requestId:randomUUID(),name:`Portable acceptance ${randomUUID()}`})).json(),requestId=randomUUID(),payload={requestId,expectedEpoch:1,file:{sha256:exported.sha256,sizeBytes:exported.sizeBytes,contentBase64:exported.contentBase64}};
 const accepted=await(await call(input.targetUrl,input.targetToken,'POST',`/whiteboards/${target.id}/portable/import`,payload)).json();assert.equal(accepted.objectCount,bundle.objects.content.length);
 const replay=await(await call(input.targetUrl,input.targetToken,'POST',`/whiteboards/${target.id}/portable/import`,payload)).json();assert.equal(replay.replayed,true);assert.equal(replay.seq,accepted.seq);
 const roundtrip=await(await call(input.targetUrl,input.targetToken,'POST',`/whiteboards/${target.id}/portable/export`,{})).json(),targetBundle=JSON.parse(Buffer.from(roundtrip.contentBase64,'base64').toString());
 const id=(source:string)=>`portable_${digest(`${requestId}:${source}`).slice(0,32)}`,actual=new Map(targetBundle.objects.content.map((object:any)=>[object.id,object]));assert.equal(actual.size,bundle.objects.content.length);
 for(const source of bundle.objects.content){const expected=structuredClone(source);expected.id=id(source.id);expected.parentId=source.parentId?id(source.parentId):null;delete expected.restoredFrom;if(expected.connector){if(expected.connector.from)expected.connector.from=id(expected.connector.from);if(expected.connector.to)expected.connector.to=id(expected.connector.to);}if(expected.extensionData?.contentObject?.type==='image')expected.extensionData.contentObject.replacementOf=null;assert.deepEqual(actual.get(expected.id),expected);}
 const sharp=createRequire(resolve(__dirname,'../../../api/package.json'))('sharp') as (bytes:Uint8Array)=>{raw():{toBuffer(options:{resolveWithObject:true}):Promise<{data:Buffer;info:{width:number;height:number}}>}};
 const images=[];
 for(const media of bundle.media){const response=await call(input.targetUrl,input.targetToken,'GET',`/whiteboards/${target.id}/assets/${media.assetId}/content`),image=await response.body();assert.equal(digest(image),media.sha256);assert.equal(image.length,media.sizeBytes);const decoded=await sharp(image).raw().toBuffer({resolveWithObject:true});assert(decoded.info.width>0&&decoded.info.height>0);images.push({hash:digest(image),width:decoded.info.width,height:decoded.info.height,pixelHash:digest(decoded.data)});}
 // A changed envelope with the same request ID must not execute another batch.
 const changed=structuredClone(bundle);changed.objects.content[0].text+=' changed';const objectBytes=Buffer.from(JSON.stringify(changed.objects.content));changed.objects.sha256=digest(objectBytes);changed.objects.sizeBytes=objectBytes.length;const changedBytes=Buffer.from(JSON.stringify(changed));
 const conflict=await input.api.post(`${input.targetUrl}/whiteboards/${target.id}/portable/import`,{headers:{Authorization:`Bearer ${input.targetToken}`},data:{...payload,file:{sha256:digest(changedBytes),sizeBytes:changedBytes.length,contentBase64:changedBytes.toString('base64')}}});assert.equal(conflict.status(),409);
 return{sourceBoardId:input.sourceBoardId,targetBoardId:target.id,requestId,exportHash:exported.sha256,accepted,replay,canonicalEquivalent:true,images};
}
