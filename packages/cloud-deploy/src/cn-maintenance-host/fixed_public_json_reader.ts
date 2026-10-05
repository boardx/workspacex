/** Bounded fixed-endpoint public JSON reader. Default fetch is executable only
 * when explicitly called by a future authorized host transport. Tests inject it. */
export function createFixedPublicJsonReader(policy: { publicOrigin: string; timeoutMs: number; maximumBytes: number }, io: { fetch: typeof fetch; now: () => Date } = { fetch: globalThis.fetch, now: () => new Date() }) {
 const origin = new URL(policy.publicOrigin);
 if(origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs < 1 || policy.timeoutMs > 30000 || !Number.isSafeInteger(policy.maximumBytes) || policy.maximumBytes < 1 || policy.maximumBytes > 1024 * 1024 || typeof io.fetch !== 'function' || typeof io.now !== 'function') throw Error('PUBLIC_JSON_READER_POLICY');
 const allowed = new Set(['/.well-known/workspacex-deployment','/api/healthz'].map(path=>new URL(path,origin).href));
 const execute = io.fetch.bind(io), now = io.now.bind(io), timeout = policy.timeoutMs, maximum = policy.maximumBytes;
 return async (url: string) => {
  if(!allowed.has(url)) throw Error('PUBLIC_JSON_FIXED_ENDPOINT_REQUIRED');
  const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let stream: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const work = async () => {
   const options: RequestInit & {cache: 'no-store'} = {method:'GET',redirect:'error',cache:'no-store',credentials:'omit',signal:abort.signal,headers:{accept:'application/json'}};
   const response = await execute(url,options);
   if(response.status !== 200 || response.redirected || response.url !== url || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw Error('PUBLIC_JSON_RESPONSE_REJECTED');
   const declared = response.headers.get('content-length');
   if(declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > maximum)) throw Error('PUBLIC_JSON_BYTE_BUDGET');
   stream = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
   while(true) {
    const next = await stream.read(); if(next.done) break;
    length += next.value.byteLength; if(length > maximum) throw Error('PUBLIC_JSON_BYTE_BUDGET'); chunks.push(next.value);
   }
   const bytes = new Uint8Array(length); let offset = 0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   const body = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!body || typeof body !== 'object' || Array.isArray(body)) throw Error('PUBLIC_JSON_OBJECT_REQUIRED');
   return {url,status:200 as const,observedAt:now().toISOString(),body};
  };
  try {
   return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('PUBLIC_JSON_TIME_BUDGET'));},timeout);})]);
  } finally { if(timer)clearTimeout(timer); abort.abort(); if(stream)void stream.cancel().catch(()=>{}); }
 };
}
