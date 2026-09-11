import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdir, lstat, rename, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const Target = z.object({ container: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/), database: identifier,
  user: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/), password: z.string().min(16).max(4096) });
export type StarterBackupTarget = z.infer<typeof Target>;
export const StarterBackupManifestSchema = z.object({ schemaVersion: z.literal(1), format: z.literal("postgres-custom"), postgresMajor: z.literal(16),
  database: identifier, sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive(), createdAt: z.string().datetime() }).strict();
export type StarterBackupManifest = z.infer<typeof StarterBackupManifestSchema>;

type RunOptions = { stdin?: number; stdout?: number; timeoutMs?: number };
async function pgTool(target: StarterBackupTarget, tool: string, args: string[], options: RunOptions = {}): Promise<string> {
  const timeoutMs=options.timeoutMs ?? 120000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000) throw new Error("INVALID_BACKUP_TIMEOUT");
  // timeout also runs INSIDE the container: killing a docker CLI alone can leave its exec
  // process running. No password values are ever present in argv or captured diagnostics.
  const command=["exec","-i","--env","PGPASSWORD","--env","PGUSER","--env","PGDATABASE","--env","PGHOST=127.0.0.1","--env","PGPORT=5432",
    target.container,"timeout","-s","KILL",String(Math.ceil(timeoutMs/1000)),tool,...args];
  return new Promise((resolve,reject) => {
    const child=spawn("docker",command,{ env:{...process.env,PGPASSWORD:target.password,PGUSER:target.user,PGDATABASE:target.database},
      shell:false,stdio:[options.stdin ?? "ignore", options.stdout ?? "pipe","ignore"],timeout:timeoutMs+2000,killSignal:"SIGKILL" });
    const chunks:Buffer[]=[]; let size=0; let overflow=false;
    child.stdout?.on("data",(chunk:Buffer)=>{ size+=chunk.length; if(size>65536){overflow=true;child.kill("SIGKILL");}else chunks.push(chunk); });
    child.once("error",()=>reject(new Error("BACKUP_TOOL_UNAVAILABLE")));
    child.once("close",code=>code===0&&!overflow?resolve(Buffer.concat(chunks).toString("utf8")):reject(new Error("BACKUP_COMMAND_FAILED")));
  });
}
async function version(target: StarterBackupTarget, tool: "pg_dump" | "pg_restore"): Promise<void> {
  const [server,client]=await Promise.all([pgTool(target,"psql",["-X","-A","-t","--set=ON_ERROR_STOP=1","--command=SHOW server_version_num"]),pgTool(target,tool,["--version"])]);
  if (Math.floor(Number(server.trim())/10000)!==16 || !new RegExp(`^${tool} \\(PostgreSQL\\) 16\\.`).test(client.trim())) throw new Error("POSTGRES_16_REQUIRED");
}
async function privateDirectory(path: string): Promise<void> {
  await mkdir(path,{recursive:true,mode:0o700}); const stat=await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode&0o077)!==0) throw new Error("UNSAFE_BACKUP_DIRECTORY");
}
async function syncDirectory(path:string):Promise<void>{ const file=await open(path,"r");try{await file.sync();}finally{await file.close();} }
async function digest(file: Awaited<ReturnType<typeof open>>): Promise<{sha256:string;bytes:number}> {
  const hash=createHash("sha256"); let bytes=0; const buffer=Buffer.alloc(131072);
  for(;;){const result=await file.read(buffer,0,buffer.length,bytes);if(!result.bytesRead)break;hash.update(buffer.subarray(0,result.bytesRead));bytes+=result.bytesRead;}
  return {sha256:hash.digest("hex"),bytes};
}

/** A new backup directory is required. Successful return means dump+manifest are synced. */
export async function backupStarterDatabase(input:StarterBackupTarget, directory:string):Promise<StarterBackupManifest> {
  const target=Target.parse(input); await version(target,"pg_dump"); await privateDirectory(directory);
  if((await readdir(directory)).length)throw new Error("BACKUP_ALREADY_EXISTS");
  const dump=join(directory,"database.dump"), manifest=join(directory,"manifest.json"), temp=join(directory,`.${randomUUID()}.tmp`);
  const lock=await open(join(directory,"backup.lock"),"wx",0o600).catch(()=>{throw new Error("BACKUP_ALREADY_EXISTS");});
  await lock.close();
  try {
    // Never overwrite a previous dump, even after an interrupted backup.
    const handle=await open(dump,"wx+",0o600);
    let integrity:{sha256:string;bytes:number};
    try { await pgTool(target,"pg_dump",["--format=custom","--lock-wait-timeout=10000"],{stdout:handle.fd}); await handle.sync(); integrity=await digest(handle); }
    finally {await handle.close();}
    if (!integrity.bytes) throw new Error("EMPTY_BACKUP");
    const value=StarterBackupManifestSchema.parse({schemaVersion:1,format:"postgres-custom",postgresMajor:16,database:target.database,...integrity,createdAt:new Date().toISOString()});
    const file=await open(temp,"wx",0o600); try{await file.writeFile(JSON.stringify(value,null,2)+"\n");await file.sync();}finally{await file.close();}
    await rename(temp,manifest); await syncDirectory(directory);
    return value;
  } finally { await unlink(temp).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}); }
}

/** Restore ONLY into a newly created database. Never --clean, --create or DROP an existing DB. */
export async function restoreStarterDatabase(input:StarterBackupTarget,directory:string):Promise<{restored:true;database:string;postgresMajor:16}> {
  const target=Target.parse(input); const dir=await lstat(directory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)!==0)throw new Error("UNSAFE_BACKUP_DIRECTORY");
  const manifestFile=await open(join(directory,"manifest.json"),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let manifest:StarterBackupManifest;
  try{const stat=await manifestFile.stat();if(!stat.isFile()||stat.size>65536||(stat.mode&0o077)!==0)throw new Error("INVALID_BACKUP_MANIFEST");manifest=StarterBackupManifestSchema.parse(JSON.parse(await manifestFile.readFile("utf8")));}finally{await manifestFile.close();}
  if(target.database===manifest.database)throw new Error("RESTORE_REQUIRES_NEW_DATABASE");
  const file=await open(join(directory,"database.dump"),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await file.stat();if(!stat.isFile()||(stat.mode&0o077)!==0)throw new Error("UNSAFE_BACKUP_FILE");
    const actual=await digest(file);if(actual.sha256!==manifest.sha256||actual.bytes!==manifest.bytes)throw new Error("BACKUP_CHECKSUM_MISMATCH");
    const admin={...target,database:"postgres"};await version(admin,"pg_restore");
    // CREATE DATABASE is itself the atomic existence guard. A same-name database causes
    // failure; a failed restore leaves this newly created DB for explicit diagnosis only.
    await pgTool(admin,"psql",["-X","--set=ON_ERROR_STOP=1","--command",`CREATE DATABASE "${target.database}" TEMPLATE template0`]);
    // A fresh descriptor starts at offset zero after the integrity pass. The directory is
    // private; compare inode identity to reject path replacement between the two opens.
    const inputFile=await open(join(directory,"database.dump"),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{const again=await inputFile.stat();if(again.ino!==stat.ino||again.dev!==stat.dev||again.size!==stat.size||again.mtimeMs!==stat.mtimeMs)throw new Error("BACKUP_CHANGED");
      await pgTool(target,"pg_restore",["--dbname",target.database,"--exit-on-error","--single-transaction","--no-owner"],{stdin:inputFile.fd});
    }finally{await inputFile.close();}
    return {restored:true,database:target.database,postgresMajor:16};
  }finally{await file.close();}
}
