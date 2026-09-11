import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { uploadStarterBackup, downloadStarterBackup, type BackupObjectStore } from "../src/backup-objects";
import { parseBackupTarget } from "../src/backup-target";
const roots:string[]=[];
async function fixture(bytes=Buffer.from("a private PG archive")){
 const root=await mkdtemp(join(tmpdir(),"backup-objects-"));roots.push(root);
 const source=join(root,"source");await mkdir(source,{mode:0o700});
 const manifest={schemaVersion:1,format:"postgres-custom",postgresMajor:16,database:"workspacex",sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,createdAt:new Date().toISOString()};
 await writeFile(join(source,"manifest.json"),JSON.stringify(manifest),{mode:0o600});await writeFile(join(source,"database.dump"),bytes,{mode:0o600});
 const objects=new Map<string,Uint8Array>(); const calls:string[]=[];
 const store:BackupObjectStore={assertReady:async()=>{},putOnce:async(key,value)=>{calls.push(key);if(objects.has(key))throw new Error("exists");objects.set(key,Buffer.from(value));},get:async key=>objects.get(key)??null,head:async key=>objects.has(key)?{sizeBytes:objects.get(key)!.byteLength,mime:"application/octet-stream"}:null};
 return{root,source,manifest,bytes,objects,calls,store,id:randomUUID()};
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
it("round trips multiple bounded chunks and publishes completion last",async()=>{
 const f=await fixture(Buffer.alloc(8*1024*1024+123,42));
 const result=await uploadStarterBackup(f.store,f.source,f.id);expect(result.readbackVerified).toBe(true);
 expect(f.calls).toEqual([`${f.id}/reservation.json`,`${f.id}/part-00000`,`${f.id}/part-00001`,`${f.id}/manifest.json`]);
 const destination=join(f.root,"download");await downloadStarterBackup(f.store,f.id,destination);
 expect(createHash("sha256").update(await readFile(join(destination,"database.dump"))).digest("hex")).toBe(f.manifest.sha256);
 expect(JSON.parse(await readFile(join(destination,"manifest.json"),"utf8"))).toEqual(f.manifest);
 expect((await stat(destination)).mode&0o077).toBe(0);expect((await stat(join(destination,"database.dump"))).mode&0o077).toBe(0);
});
it("never overwrites or resumes an existing ID",async()=>{const f=await fixture();await uploadStarterBackup(f.store,f.source,f.id);const before=new Map(f.objects);await expect(uploadStarterBackup(f.store,f.source,f.id)).rejects.toThrow("exists");expect(f.objects).toEqual(before);});
it("does not publish manifest if service readback is corrupt",async()=>{const f=await fixture();const original=f.store.get;f.store.get=async key=>key.includes("part-")?Buffer.alloc(f.bytes.length,0):original(key);await expect(uploadStarterBackup(f.store,f.source,f.id)).rejects.toThrow("BACKUP_READBACK_MISMATCH");expect(f.objects.has(`${f.id}/manifest.json`)).toBe(false);});
it("rejects local checksum mismatch without a completion marker",async()=>{const f=await fixture();await writeFile(join(f.source,"database.dump"),Buffer.alloc(f.bytes.length,0));await expect(uploadStarterBackup(f.store,f.source,f.id)).rejects.toThrow("BACKUP_CHECKSUM_MISMATCH");expect(f.objects.has(`${f.id}/manifest.json`)).toBe(false);});
it("never overwrites existing local destination",async()=>{const f=await fixture();await uploadStarterBackup(f.store,f.source,f.id);await expect(downloadStarterBackup(f.store,f.id,f.source)).rejects.toThrow();expect(await readFile(join(f.source,"database.dump"))).toEqual(f.bytes);});
it("rejects missing or corrupted remote pieces and leaves no restore manifest",async()=>{const f=await fixture();await uploadStarterBackup(f.store,f.source,f.id);f.objects.set(`${f.id}/part-00000`,Buffer.alloc(f.bytes.length,0));const dest=join(f.root,"damaged");await expect(downloadStarterBackup(f.store,f.id,dest)).rejects.toThrow("BACKUP_CHECKSUM_MISMATCH");await expect(stat(join(dest,"manifest.json"))).rejects.toThrow();});
it("rejects remote manifest keys and unsafe backup IDs",async()=>{const f=await fixture();await uploadStarterBackup(f.store,f.source,f.id);const key=`${f.id}/manifest.json`;const m=JSON.parse(Buffer.from(f.objects.get(key)!).toString());m.parts[0].key="../../unrelated";f.objects.set(key,Buffer.from(JSON.stringify(m)));await expect(downloadStarterBackup(f.store,f.id,join(f.root,"bad"))).rejects.toThrow();await expect(uploadStarterBackup(f.store,f.source,"../other-prefix")).rejects.toThrow();});
it("requires strictly scoped ECS-role target with regional TLS endpoint",()=>{
 const target={backend:"oss",bucket:"backup-bucket",region:"cn-hangzhou",endpoint:"https://oss-cn-hangzhou-internal.aliyuncs.com",prefix:"backups/install-1",authMode:"ecs-role",roleName:"backup-role"};
 expect(parseBackupTarget(JSON.stringify(target))).toEqual(target);
 for(const change of [{accessKeySecret:"private"},{prefix:"../anywhere"},{prefix:""},{endpoint:"http://oss-cn-hangzhou.aliyuncs.com"},{endpoint:"https://evil.invalid"},{authMode:"environment"}])expect(()=>parseBackupTarget(JSON.stringify({...target,...change}))).toThrow("INVALID_BACKUP_TARGET");
});
