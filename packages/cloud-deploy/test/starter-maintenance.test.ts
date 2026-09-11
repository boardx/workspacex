import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { maintainStarter, type MaintenanceRun } from "../src/starter-maintenance";
import { deploymentExample } from "../src/examples";
vi.setConfig({testTimeout:15000});
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),"starter-maintenance-"));roots.push(root);const runtime=join(root,"runtime");await mkdir(join(runtime,"secrets"),{recursive:true,mode:0o700});
 const config=deploymentExample("starter");const image={image:`registry.example/team/app@sha256:${"a".repeat(64)}`};
 const manifest={schemaVersion:1,release:config.provision.release,sourceRevision:"b".repeat(40),platform:"linux/amd64",images:{web:image,api:image,agent:image,sandbox:image,postgres:image,redis:image}};
 await writeFile(join(runtime,"compose.json"),JSON.stringify({name:"fixture",services:{api:image,postgres:image}}),{mode:0o600});await writeFile(join(runtime,"secrets","owner-password"),"c".repeat(64),{mode:0o600});
 const target={backend:"oss",region:"cn-hangzhou",bucket:"backup-bucket",endpoint:"https://oss-cn-hangzhou-internal.aliyuncs.com",prefix:"backups/fixture",authMode:"ecs-role",roleName:"backup-role"};
 const source={WORKSPACEX_BACKUP_TARGET:JSON.stringify(target)};
 const container={Id:"d".repeat(64),State:{Running:true},Config:{Image:image.image,Labels:{"com.docker.compose.project":"fixture","com.docker.compose.service":"postgres"}},Mounts:[{Type:"bind",Source:"/var/lib/workspacex/postgres",Destination:"/var/lib/postgresql/data",RW:true}]};
 const archive={schemaVersion:1 as const,format:"postgres-custom" as const,postgresMajor:16 as const,database:"workspacex",sha256:"e".repeat(64),bytes:123,createdAt:new Date().toISOString()};
 const backup=vi.fn(async(_input,dir)=>{await mkdir(dir,{mode:0o700});await writeFile(join(dir,"manifest.json"),JSON.stringify(archive),{mode:0o600});return archive;});
 const restore=vi.fn(async input=>({restored:true as const,database:input.database,postgresMajor:16 as const}));
 const calls:string[][]=[];
 let uploadedEnv="";
 const run:MaintenanceRun=vi.fn(async(args)=>{
  calls.push([...args]);
  if(args[1]==="ps")return args.includes("--all")?"":"d".repeat(64);
  if(args[1]==="inspect")return JSON.stringify([container]);
  if(args[1]==="image")return JSON.stringify([{Os:"linux",Architecture:"amd64",RepoDigests:[image.image],Config:{Labels:{"org.opencontainers.image.revision":manifest.sourceRevision}}}]);
  if(args[1]==="run"){
   uploadedEnv=await readFile(args[args.indexOf("--env-file")+1]!,"utf8");
   const download=args.includes("download"),id=download?args.at(-1)!:randomUUID();
   if(download){const mount=args[args.indexOf("--mount")+1]!;const host=mount.match(/src=([^,]+)/)![1]!;await mkdir(join(host,"archive"),{mode:0o700});await writeFile(join(host,"archive","manifest.json"),JSON.stringify(archive),{mode:0o600});}
   return JSON.stringify({ok:true,backupId:id,sha256:archive.sha256,bytes:archive.bytes,...download?{downloaded:true}:{uploaded:true,readbackVerified:true}});
  }
  throw new Error("unexpected command");
 });
 return{root,runtime,config,manifest,container,source,backup,restore,run,calls,env:()=>uploadedEnv,options:{operation:"backup" as const,runtimeDirectory:runtime,backupDirectory:join(root,"backup")}};
}
it("automatically backs up the exact deployment and uploads through digest job with private env-file",async()=>{
 const f=await fixture();expect(await maintainStarter(f.config,f.manifest,f.options,f,f.source)).toMatchObject({ok:true,operation:"backup"});
 expect(f.backup.mock.calls[0]?.[0]).toMatchObject({container:"d".repeat(64),database:"workspacex",password:"c".repeat(64)});
 const job=f.calls.find(a=>a[1]==="run")!;expect(job).toContain(f.manifest.images.api.image);expect(job).toContain("--pull=never");expect(job).toContain("0:0");expect(job).toContain(`type=bind,src=${f.options.backupDirectory},dst=/backup,readonly`);
 expect(job.filter(x=>x==="--mount")).toHaveLength(1);expect(JSON.stringify(f.calls)).not.toContain("c".repeat(64));expect(JSON.stringify(f.calls)).not.toContain("backup-role");expect(f.env()).toContain("STARTER_BACKUP_TARGET_JSON=");
 expect(await readdir(f.runtime)).toEqual(expect.arrayContaining(["compose.json","secrets"]));expect((await readdir(f.runtime)).some(name=>name.endsWith(".env")||name.endsWith(".lock"))).toBe(false);
});
it("downloads then restores into only the explicit new database",async()=>{const f=await fixture();const id=randomUUID();const result=await maintainStarter(f.config,f.manifest,{...f.options,operation:"restore",database:"restored_2026",backupId:id},f,f.source);expect(result).toMatchObject({operation:"restore",database:"restored_2026",backupId:id});expect(f.backup).not.toHaveBeenCalled();expect(f.restore).toHaveBeenCalledOnce();expect(f.restore.mock.calls[0]?.[0].database).toBe("restored_2026");expect(f.calls.find(a=>a[1]==="run")).toContain("download");});
it("rejects existing directories before dump or transfer",async()=>{const f=await fixture();await mkdir(f.options.backupDirectory);await expect(maintainStarter(f.config,f.manifest,f.options,f,f.source)).rejects.toThrow();expect(f.backup).not.toHaveBeenCalled();expect(f.calls.some(a=>a[1]==="run")).toBe(false);});
it("refuses foreign PG storage and does not rotate a missing owner secret",async()=>{const f=await fixture();f.container.Mounts[0]!.Source="/other/postgres";await expect(maintainStarter(f.config,f.manifest,f.options,f,f.source)).rejects.toThrow("STARTER_POSTGRES_IDENTITY_MISMATCH");f.container.Mounts[0]!.Source="/var/lib/workspacex/postgres";await rm(join(f.runtime,"secrets","owner-password"));await expect(maintainStarter(f.config,f.manifest,f.options,f,f.source)).rejects.toThrow("SECRET_UNAVAILABLE");expect(await readdir(join(f.runtime,"secrets"))).toEqual([]);expect(f.backup).not.toHaveBeenCalled();});
it("excludes production and live database restore names",async()=>{const f=await fixture();await expect(maintainStarter(deploymentExample("production"),f.manifest,f.options,f,f.source)).rejects.toThrow("STARTER_MAINTENANCE_ONLY");for(const database of ["workspacex","workspacex_agent","workspacex_memory","postgres","template1"]){await expect(maintainStarter(f.config,f.manifest,{...f.options,operation:"restore",database,backupId:randomUUID()},f,f.source)).rejects.toThrow();}expect(f.run).not.toHaveBeenCalled();});
it("uses the provision lock to reject concurrent provision or maintenance",async()=>{const f=await fixture();await writeFile(join(f.runtime,"provision.lock"),"existing",{mode:0o600});await expect(maintainStarter(f.config,f.manifest,f.options,f,f.source)).rejects.toThrow();expect(await readFile(join(f.runtime,"provision.lock"),"utf8")).toBe("existing");expect(f.run).not.toHaveBeenCalled();});
it("retains shared lock if cleanup of the exact maintenance job cannot be proved",async()=>{const f=await fixture();const original=f.run;const run:MaintenanceRun=async(args,ctx)=>{if(args.includes("--all"))throw new Error("daemon unavailable");return original(args,ctx);};await expect(maintainStarter(f.config,f.manifest,f.options,{...f,run},f.source)).rejects.toThrow("MAINTENANCE_JOB_CLEANUP_UNPROVEN");expect(await readdir(f.runtime)).toContain("provision.lock");expect((await readdir(f.runtime)).some(name=>name.endsWith(".env"))).toBe(false);});
it("refuses empty job success output and never restores after it",async()=>{const f=await fixture();const original=f.run;const run:MaintenanceRun=async(args,ctx)=>args[1]==="run"?"{}":original(args,ctx);await expect(maintainStarter(f.config,f.manifest,{...f.options,operation:"restore",database:"fresh_db",backupId:randomUUID()},{...f,run},f.source)).rejects.toThrow();expect(f.restore).not.toHaveBeenCalled();});
it("cancels before touching the deployment and releases no foreign lock",async()=>{const f=await fixture();const controller=new AbortController();controller.abort();await expect(maintainStarter(f.config,f.manifest,f.options,f,f.source,controller.signal)).rejects.toThrow("MAINTENANCE_CANCELLED");expect(f.run).not.toHaveBeenCalled();expect(await readdir(f.runtime)).not.toContain("provision.lock");});
it("stops its exact leftover job and removes private env after a transfer error",async()=>{const f=await fixture();const original=f.run;const cleanup:string[][]=[];const run:MaintenanceRun=async(args,ctx)=>{if(args[1]==="run")throw new Error("transfer failed");if(args.includes("--all"))return"a".repeat(64);if(args[1]==="rm"){cleanup.push([...args]);return"";}return original(args,ctx);};await expect(maintainStarter(f.config,f.manifest,f.options,{...f,run},f.source)).rejects.toThrow("transfer failed");expect(cleanup).toHaveLength(1);expect(cleanup[0]?.slice(0,3)).toEqual(["docker","rm","--force"]);expect(cleanup[0]?.[3]).toMatch(/^wsx-maintenance-[a-f0-9-]{36}$/);expect((await readdir(f.runtime)).some(name=>name.endsWith(".env")||name.endsWith(".lock"))).toBe(false);});

it("backs up isolated Memory database using the same protected maintenance workflow",async()=>{const f=await fixture();await maintainStarter(f.config,f.manifest,{...f.options,database:"workspacex_memory"},f,f.source);expect(f.backup.mock.calls[0]?.[0].database).toBe("workspacex_memory");});
