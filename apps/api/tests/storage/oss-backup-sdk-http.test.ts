import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OSS from "ali-oss";
import { expect, it } from "vitest";
import { privateBackupStore } from "../../scripts/backup-oss-adapter";
import { wrapOssSdk } from "../../src/infrastructure/storage/oss-sdk-client";
import { uploadStarterBackup, downloadStarterBackup } from "../../../../packages/cloud-deploy/src/backup-objects";

it("actual OSS SDK round trips backup with signed private/write-once requests; rejects public and versioned buckets",async()=>{
 const objects=new Map<string,{bytes:Buffer;headers:Record<string,string>}>();let acl="private",version="";const methods:string[]=[];
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url!,"http://localhost");methods.push(req.method!);
  const error=(status:number,code:string)=>{res.writeHead(status,{"Content-Type":"application/xml"});res.end(`<Error><Code>${code}</Code><Message>fixture</Message><RequestId>fixture</RequestId></Error>`);};
  if(!req.headers.authorization?.startsWith("OSS4-HMAC-SHA256 ")){error(403,"AccessDenied");return;}
  if(url.searchParams.has("acl")){res.setHeader("Content-Type","application/xml");res.end(`<AccessControlPolicy><Owner><ID>fixture</ID></Owner><AccessControlList><Grant>${acl}</Grant></AccessControlList></AccessControlPolicy>`);return;}
  if(url.searchParams.has("versioning")){res.setHeader("Content-Type","application/xml");res.end(`<VersioningConfiguration>${version?`<Status>${version}</Status>`:""}</VersioningConfiguration>`);return;}
  const key=decodeURIComponent(url.pathname.slice(1));
  if(req.method==="PUT"){
   if(req.headers["x-oss-forbid-overwrite"]!=="true"||req.headers["x-oss-object-acl"]!=="private"){error(400,"UnsafeBackup");return;}
   if(objects.has(key)){error(409,"FileAlreadyExists");return;}
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks);
   if(req.headers["content-md5"]!==createHash("md5").update(bytes).digest("base64")){error(400,"InvalidDigest");return;}
   objects.set(key,{bytes,headers:{"content-length":String(bytes.length),"content-type":String(req.headers["content-type"]),"x-oss-meta-sha256":String(req.headers["x-oss-meta-sha256"])}});res.setHeader("ETag",`"${createHash("md5").update(bytes).digest("hex")}"`);res.end();return;
  }
  const object=objects.get(key);if(!object){error(404,"NoSuchKey");return;}res.writeHead(200,object.headers);res.end(req.method==="HEAD"?undefined:object.bytes);
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const root=await mkdtemp(join(tmpdir(),"oss-backup-http-"));
 try{
  const sdk=new OSS({accessKeyId:"fixture",accessKeySecret:"fixture",region:"oss-cn-hangzhou",bucket:"backup-bucket",authorizationV4:true,endpoint:`http://127.0.0.1:${(server.address()as AddressInfo).port}`,cname:true,timeout:2000});
  const store=privateBackupStore(wrapOssSdk(sdk),"backup-bucket","backups/fixture");
  const source=join(root,"source");await mkdir(source,{mode:0o700});const bytes=Buffer.from("private PostgreSQL dump");
  await writeFile(join(source,"database.dump"),bytes,{mode:0o600});await writeFile(join(source,"manifest.json"),JSON.stringify({schemaVersion:1,format:"postgres-custom",postgresMajor:16,database:"workspacex",sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,createdAt:new Date().toISOString()}),{mode:0o600});
  const id=randomUUID();await uploadStarterBackup(store,source,id);await downloadStarterBackup(store,id,join(root,"download"));expect(await readFile(join(root,"download","database.dump"))).toEqual(bytes);
  await expect(uploadStarterBackup(store,source,id)).rejects.toThrow();
  acl="public-read";await expect(uploadStarterBackup(store,source)).rejects.toThrow();acl="private";
  for(const state of ["Enabled","Suspended"]){version=state;await expect(uploadStarterBackup(store,source)).rejects.toThrow();}
  expect(methods).not.toContain("DELETE");expect([...objects.keys()].every(key=>key.startsWith(`backups/fixture/${id}/`))).toBe(true);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
