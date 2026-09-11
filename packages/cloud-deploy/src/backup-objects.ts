import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { StarterBackupManifestSchema } from "./starter-backup";

export interface BackupObjectStore {
  assertReady(): Promise<void>;
  putOnce(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<{sizeBytes: number; mime: string} | null>;
}
const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_PARTS = 10000;
const backupIdSchema = z.string().uuid();
const RemoteManifest = z.object({ schemaVersion: z.literal(1), backupId: backupIdSchema,
  backup: StarterBackupManifestSchema,
  parts: z.array(z.object({ bytes: z.number().int().positive().max(CHUNK_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(MAX_PARTS),
}).strict();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const partKey = (id: string, index: number) => `${id}/part-${String(index).padStart(5,"0")}`;
async function privateFile(path:string) {
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await file.stat();
  if(!stat.isFile()||(stat.mode&0o077)!==0){await file.close();throw new Error("UNSAFE_BACKUP_FILE");}
  return file;
}
async function privateDirectory(path:string) {
  const stat=await lstat(path);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error("UNSAFE_BACKUP_DIRECTORY");
}
async function checkedGet(store:BackupObjectStore,key:string,max:number):Promise<Uint8Array> {
  const meta=await store.head(key);
  if(!meta||meta.sizeBytes<1||meta.sizeBytes>max)throw new Error("INVALID_REMOTE_BACKUP_SIZE");
  const bytes=await store.get(key);
  if(!bytes||bytes.byteLength!==meta.sizeBytes)throw new Error("BACKUP_READBACK_MISMATCH");
  return bytes;
}
async function putVerified(store:BackupObjectStore,key:string,bytes:Uint8Array,mime:string) {
  await store.putOnce(key,bytes,mime);
  const actual=await checkedGet(store,key,bytes.byteLength);
  if(hash(actual)!==hash(bytes))throw new Error("BACKUP_READBACK_MISMATCH");
}

/** Each object is write-once. An interrupted ID is never reused or automatically deleted. */
export async function uploadStarterBackup(store:BackupObjectStore,directory:string,id:string=randomUUID()) {
  backupIdSchema.parse(id); await privateDirectory(directory); await store.assertReady();
  const manifestFile=await privateFile(join(directory,"manifest.json"));
  let backup:z.infer<typeof StarterBackupManifestSchema>;
  try{if((await manifestFile.stat()).size>65536)throw new Error("INVALID_BACKUP_MANIFEST");backup=StarterBackupManifestSchema.parse(JSON.parse(await manifestFile.readFile("utf8")));}
  finally{await manifestFile.close();}
  if(backup.bytes>CHUNK_BYTES*MAX_PARTS)throw new Error("BACKUP_TOO_LARGE");
  const file=await privateFile(join(directory,"database.dump"));
  try{
    if((await file.stat()).size!==backup.bytes)throw new Error("BACKUP_CHECKSUM_MISMATCH");
    // Reservation serializes concurrent attempts and protects partially uploaded IDs.
    await putVerified(store,`${id}/reservation.json`,Buffer.from(JSON.stringify({schemaVersion:1,backupId:id})),"application/json");
    const parts:{bytes:number;sha256:string}[]=[], digest=createHash("sha256");
    let offset=0;
    while(offset<backup.bytes){
      const buffer=Buffer.alloc(Math.min(CHUNK_BYTES,backup.bytes-offset));let read=0;
      while(read<buffer.length){const value=await file.read(buffer,read,buffer.length-read,offset+read);if(!value.bytesRead)throw new Error("BACKUP_CHANGED");read+=value.bytesRead;}
      digest.update(buffer);const sha256=hash(buffer);
      await putVerified(store,partKey(id,parts.length),buffer,"application/octet-stream");
      parts.push({bytes:buffer.length,sha256});offset+=buffer.length;
    }
    if(digest.digest("hex")!==backup.sha256)throw new Error("BACKUP_CHECKSUM_MISMATCH");
    const remote=RemoteManifest.parse({schemaVersion:1,backupId:id,backup,parts});
    await putVerified(store,`${id}/manifest.json`,Buffer.from(JSON.stringify(remote)),"application/json");
    return {uploaded:true as const,backupId:id,sha256:backup.sha256,bytes:backup.bytes,readbackVerified:true as const};
  }finally{await file.close();}
}

/** Download to a NEW private directory. Only a fully verified download gets a manifest. */
export async function downloadStarterBackup(store:BackupObjectStore,id:string,directory:string) {
  backupIdSchema.parse(id);await store.assertReady();
  const raw=await checkedGet(store,`${id}/manifest.json`,2*1024*1024);
  const remote=RemoteManifest.parse(JSON.parse(Buffer.from(raw).toString("utf8")));
  if(remote.backupId!==id||remote.parts.reduce((n,p)=>n+p.bytes,0)!==remote.backup.bytes)throw new Error("INVALID_REMOTE_BACKUP_MANIFEST");
  await mkdir(directory,{mode:0o700});await privateDirectory(directory);
  const file=await open(join(directory,"database.dump"),"wx",0o600);
  try{
    const digest=createHash("sha256");
    for(const [index,part] of remote.parts.entries()){
      const bytes=await checkedGet(store,partKey(id,index),part.bytes);
      if(bytes.byteLength!==part.bytes||hash(bytes)!==part.sha256)throw new Error("BACKUP_CHECKSUM_MISMATCH");
      digest.update(bytes);await file.writeFile(bytes);
    }
    if(digest.digest("hex")!==remote.backup.sha256)throw new Error("BACKUP_CHECKSUM_MISMATCH");
    await file.sync();
  }finally{await file.close();}
  const temp=join(directory,`.${randomUUID()}.tmp`), manifest=await open(temp,"wx",0o600);
  try{await manifest.writeFile(JSON.stringify(remote.backup,null,2)+"\n");await manifest.sync();}finally{await manifest.close();}
  try{await link(temp,join(directory,"manifest.json"));}finally{await unlink(temp);}
  const dir=await open(directory,"r");try{await dir.sync();}finally{await dir.close();}
  return {downloaded:true as const,backupId:id,sha256:remote.backup.sha256,bytes:remote.backup.bytes};
}
