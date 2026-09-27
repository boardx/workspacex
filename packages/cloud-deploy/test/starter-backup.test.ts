import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
const invoked=vi.hoisted(()=>vi.fn(()=>{throw new Error("must not invoke Docker before validation");}));
vi.mock("node:child_process",()=>({spawn:invoked}));
import { backupStarterDatabase, restoreStarterDatabase } from "../src/starter-backup";
const target={container:"starter-postgres",database:"new_database",user:"postgres",password:"test-private-password"};
const roots:string[]=[];
afterEach(async()=>{vi.clearAllMocks();await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function fixture(extra={}){
 const root=await mkdtemp(join(tmpdir(),"backup-validation-"));roots.push(root);const bytes=Buffer.from("not-an-actual-pg-archive");
 await writeFile(join(root,"database.dump"),bytes,{mode:0o600});
 await writeFile(join(root,"manifest.json"),JSON.stringify({schemaVersion:1,format:"postgres-custom",postgresMajor:16,database:"source_database",sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,createdAt:new Date().toISOString(),...extra}),{mode:0o600});return root;
}
it("rejects same database before any Docker invocation",async()=>{await expect(restoreStarterDatabase({...target,database:"source_database"},await fixture())).rejects.toThrow("RESTORE_REQUIRES_NEW_DATABASE");expect(invoked).not.toHaveBeenCalled();});
it("rejects corruption before creating a target database",async()=>{await expect(restoreStarterDatabase(target,await fixture({sha256:"0".repeat(64)}))).rejects.toThrow("BACKUP_CHECKSUM_MISMATCH");expect(invoked).not.toHaveBeenCalled();});
it("rejects incompatible major version before database changes",async()=>{await expect(restoreStarterDatabase(target,await fixture({postgresMajor:17}))).rejects.toThrow();expect(invoked).not.toHaveBeenCalled();});
it("refuses symlinked backup payloads",async()=>{const root=await fixture();await rm(join(root,"database.dump"));await symlink(join(root,"manifest.json"),join(root,"database.dump"));await expect(restoreStarterDatabase(target,root)).rejects.toThrow();expect(invoked).not.toHaveBeenCalled();});
it.each(["--help","source; DROP DATABASE workspacex","/escape"])("rejects unsafe restore name %s",async database=>{await expect(restoreStarterDatabase({...target,database},await fixture())).rejects.toThrow();expect(invoked).not.toHaveBeenCalled();});
it("refuses a container option disguised as an identifier",async()=>{await expect(backupStarterDatabase({...target,container:"--privileged"},"unused")).rejects.toThrow();expect(invoked).not.toHaveBeenCalled();});

it("accepts an existing short credential and passes it only through child environment",async()=>{
 const password="legacy";
 await expect(backupStarterDatabase({...target,password},"unused")).rejects.toThrow("must not invoke Docker before validation");
 expect(invoked).toHaveBeenCalled();
 for(const call of invoked.mock.calls as unknown as Array<[string,string[],{env:Record<string,string>;shell:boolean}]>){
  expect(call[0]).toBe("docker");expect(call[1]).not.toContain(password);expect(call[2].shell).toBe(false);expect(call[2].env.PGPASSWORD).toBe(password);
 }
});
it.each(["","bad\0credential","x".repeat(4097)])("rejects unusable credential before invoking a tool",async password=>{
 await expect(backupStarterDatabase({...target,password},"unused")).rejects.toThrow();expect(invoked).not.toHaveBeenCalled();
 await expect(restoreStarterDatabase({...target,password},await fixture())).rejects.toThrow();expect(invoked).not.toHaveBeenCalled();
});
it("accepts a short existing credential on restore while retaining integrity guards",async()=>{
 await expect(restoreStarterDatabase({...target,password:"legacy"},await fixture({sha256:"0".repeat(64)}))).rejects.toThrow("BACKUP_CHECKSUM_MISMATCH");expect(invoked).not.toHaveBeenCalled();
});
