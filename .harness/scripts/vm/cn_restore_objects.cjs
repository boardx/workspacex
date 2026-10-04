'use strict';
const {createHash}=require('node:crypto');
const must=(v,c)=>{if(!v)throw Error(c)};
function headers(res){const out={};for(const [k,v]of Object.entries(res?.headers||{}))out[k.toLowerCase()]=String(v);return out;}
function identity(result,t){must(result?.res?.status===200,'OBJECT_HTTP_STATUS');const h=headers(result.res);must(h['content-length']===String(t.bytes)&&!h['content-range']&&!h['content-encoding'],'OBJECT_LENGTH_OR_ENCODING');must(h.etag&& !/[\r\n]/.test(h.etag),'OBJECT_ETAG');must((h['x-oss-version-id']??null)===t.versionId,'OBJECT_VERSION');return h;}
/** sdk is the raw ali-oss instance from the trusted canonical ECS-role/config factory.
 * keyOf MUST be the canonical namespace resolver; caller binds bucket/namespace independently.
 * No writes, metadata digests, or credentials are emitted. */
function validateTuple(config,t,keyOf){
 must(config.bucket===t.bucket&&config.prefix===t.namespace,'OBJECT_CONFIG_BINDING');
 must(typeof keyOf==='function'&&typeof t.key==='string'&&Number.isSafeInteger(t.bytes)&&t.bytes>=0&&/^[a-f0-9]{64}$/.test(t.sha256),'OBJECT_TUPLE');
 must(t.versionId===null||(typeof t.versionId==='string'&&t.versionId.length>0&&t.versionId.length<=1024&&!/[\r\n\x00-\x1f]/.test(t.versionId)),'OBJECT_VERSION_INPUT');
 const key=keyOf(t.key);must(key===`${t.namespace}/${t.key}`,'OBJECT_KEY_BINDING');
 return key;
}
async function audit(sdk,config,t,keyOf){
 const key=validateTuple(config,t,keyOf);
 const options=t.versionId===null?{}:{versionId:t.versionId};
 let result;try{
 const before=identity(await sdk.head(key,options),t);
 const readOptions=t.versionId===null?{headers:{'If-Match':before.etag}}:{subres:{versionId:t.versionId}};
 result=await sdk.getStream(key,readOptions);const h=identity(result,t);must(h.etag===before.etag,'OBJECT_CHANGED');
 must(result.stream&&typeof result.stream[Symbol.asyncIterator]==='function','OBJECT_STREAM');
 let bytes=0;const hash=createHash('sha256');for await(const chunk of result.stream){must(Buffer.isBuffer(chunk)||chunk instanceof Uint8Array,'OBJECT_CHUNK');bytes+=chunk.length;must(bytes<=t.bytes,'OBJECT_OVERSIZE');hash.update(chunk);}
 must(result.stream.readableEnded===true&&!result.stream.errored,'OBJECT_STREAM_EOF');
 must(bytes===t.bytes&&hash.digest('hex')===t.sha256,'OBJECT_CONTENT_MISMATCH');
 const after=identity(await sdk.head(key,options),t);must(after.etag===before.etag,'OBJECT_CHANGED');
 return {schemaVersion:1,tuple:{bucket:t.bucket,namespace:t.namespace,key:t.key,versionId:t.versionId,bytes:t.bytes,sha256:t.sha256},actualBytesVerified:true,actualSha256Verified:true,completeStreamVerified:true};
 }catch(error){result?.stream?.destroy();throw Error(/^OBJECT_[A-Z_]+$/.test(error?.message||'')?error.message:'OBJECT_READ_FAILED');}
}
module.exports={audit,validateTuple};
