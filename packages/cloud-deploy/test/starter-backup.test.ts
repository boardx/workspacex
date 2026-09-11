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
