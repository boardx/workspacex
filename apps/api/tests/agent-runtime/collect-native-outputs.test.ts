import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { collectNativeOutputs } from "../../src/application/agent-run/collect-native-outputs";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root,{ recursive:true,force:true }))); });
async function objects() { const root=await mkdtemp(join(tmpdir(),"native-output-")); roots.push(root); return new FsObjectStore(root); }
const bytes=Buffer.from([0,255,128,42]);
const response=(path:string)=>({ path,contentBase64:bytes.toString("base64"),sizeBytes:bytes.length });
it("stores actual binary bytes with run-scoped digest, validates readback and safely repeats",async()=>{
 const store=await objects(); const deps={ objects:store,sessionFiles:{ read:async(path:string)=>response(path) } };
 const input={runId:"run-a",paths:["/workspace/out/report.pdf"]};
 const files=await collectNativeOutputs(deps,input);
 expect(files[0]).toMatchObject({name:"report.pdf",mime:"application/pdf",sizeBytes:4});
 expect(files[0]!.objectKey).toContain(createHash("sha256").update(bytes).digest("hex"));
 expect(await store.get(files[0]!.objectKey)).toEqual(new Uint8Array(bytes));
 expect(await collectNativeOutputs(deps,input)).toEqual(files);
 expect((await collectNativeOutputs(deps,{...input,runId:"run-b"}))[0]!.objectKey).not.toBe(files[0]!.objectKey);
});
it.each(["/skills/a","/workspace/../a","/workspace//a","/workspace/a/","/workspace/a\\b","/workspace/./a"])("rejects noncanonical path %s before reading",async path=>{
 let reads=0; await expect(collectNativeOutputs({objects:await objects(),sessionFiles:{read:async()=>{reads++;return {};}}},{runId:"r",paths:[path]})).rejects.toThrow(); expect(reads).toBe(0);
});
it.each([{contentBase64:"AB=="},{sizeBytes:99},{path:"/workspace/other"},{isDirectory:true}])("rejects malformed read response %j",async change=>{
 await expect(collectNativeOutputs({objects:await objects(),sessionFiles:{read:async path=>({...response(path),...change})}},{runId:"r",paths:["/workspace/a"]})).rejects.toThrow();
});
it("rejects duplicate output basenames",async()=>{
 await expect(collectNativeOutputs({objects:await objects(),sessionFiles:{read:async path=>response(path)}},{runId:"r",paths:["/workspace/a/x","/workspace/b/x"]})).rejects.toThrow();
});
it("returns no references on write failure or corrupt readback",async()=>{
 const real=await objects();
 for(const store of [{putOnce:async()=>{throw Error("disk-full");},get:real.get.bind(real)}, {putOnce:real.putOnce.bind(real),get:async()=>new Uint8Array([9])}]){
 await expect(collectNativeOutputs({objects:{...store,head:real.head.bind(real)},sessionFiles:{read:async path=>response(path)}},{runId:"r",paths:["/workspace/a"]})).rejects.toThrow();
 }
});
it("enforces count, single-file and aggregate transport budgets",async()=>{
 const {sandboxSession:S}=await import("@repo/contracts");
 let reads=0; const store=await objects();
 await expect(collectNativeOutputs({objects:store,sessionFiles:{read:async()=>{reads++;return {};}}},
 {runId:"r",paths:Array.from({length:S.limits.maxFiles+1},(_,i)=>`/workspace/${i}`)})).rejects.toThrow();
 expect(reads).toBe(0);
 const oversized=Buffer.alloc(S.limits.maxFileBytes+1);
 await expect(collectNativeOutputs({objects:store,sessionFiles:{read:async path=>({path,sizeBytes:oversized.length,contentBase64:oversized.toString("base64")})}},
 {runId:"r",paths:["/workspace/large"]})).rejects.toThrow();
 const full=Buffer.alloc(S.limits.maxFileBytes,3);
 const paths=Array.from({length:Math.floor(S.limits.maxRequestBytes/full.length)+1},(_,i)=>`/workspace/${i}`);
 await expect(collectNativeOutputs({objects:store,sessionFiles:{read:async path=>({path,sizeBytes:full.length,contentBase64:full.toString("base64")})}},
 {runId:"r",paths})).rejects.toThrow("native_output_size");
});
it("propagates directory/download rejection without writing",async()=>{
 const store=await objects();let writes=0;
 await expect(collectNativeOutputs({objects:{get:store.get.bind(store),head:store.head.bind(store),putOnce:async()=>{writes++;}},
 sessionFiles:{read:async()=>{throw Error("directory");}}},{runId:"r",paths:["/workspace/folder"]})).rejects.toThrow("directory");
 expect(writes).toBe(0);
});
