import { mkdtempSync,readFileSync,writeFileSync,statSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";import { join,resolve } from "node:path";import { spawnSync } from "node:child_process";
import { expect,it } from "vitest";import { binding } from "./cn-migration-snapshot.fixture";
it("trusted CLI independently derives binding privately and refuses source mutation/existing output without printing private metadata",()=>{
 const dir=mkdtempSync(join(tmpdir(),"source-binding-cli-"));const cli=resolve("src/cn-migration-source-binding-cli.ts");
 const e=join(dir,"e.json"),a=join(dir,"audit.json"),d=join(dir,"dispatch.json"),out=join(dir,"binding.json");
 const audit={schemaVersion:1,readOnly:true,configuredRegionId:binding.source.regionId,configuredRdsInstanceId:binding.source.dbInstanceId,
  configurationSha256:binding.source.configurationSha256,endpointSha256:binding.source.endpointSha256,database:binding.source.database,user:binding.source.user,
  serverAddressSha256:binding.source.serverAddressSha256,port:binding.source.port,clientPeerAddressSha256:binding.source.clientPeerAddressSha256,
  clientPeerPort:binding.source.clientPeerPort,sslMode:binding.source.sslMode,clientEncrypted:true,clientTlsAuthorized:true};
 const run=(dest=out)=>spawnSync(process.execPath,["--import","tsx",cli,"sql-server-address",e,a,d,dest],{encoding:"utf8"});
 try{for(const [path,data] of [[e,binding.sourceEvidence],[a,audit],[d,binding.cloud]] as const)writeFileSync(path,JSON.stringify(data),{mode:0o600});
 const ok=run();expect(ok.status).toBe(0);expect(ok.stdout).toBe("MIGRATION_SNAPSHOT_PRIVATE_BINDING_READY\n");expect(statSync(out).mode&0o777).toBe(0o600);expect(JSON.parse(readFileSync(out,"utf8"))).toEqual(binding);
 const again=run();expect(again.status).toBe(2);expect(again.stdout).toBe("");expect(readFileSync(out,"utf8")).toContain(binding.source.accountId);
 writeFileSync(a,JSON.stringify({...audit,user:"secret_private_wrong_user"}));const bad=run(join(dir,"must-not-exist.json"));expect(bad.status).toBe(2);expect(bad.stdout).toBe("");expect(bad.stderr).not.toContain("secret_private_wrong_user");expect(bad.stderr).toContain("MIGRATION_SNAPSHOT_PROTECTED_CONFIGURATION_MISMATCH");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
