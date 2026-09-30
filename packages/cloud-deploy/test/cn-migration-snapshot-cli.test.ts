import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { migrationHash } from "../src/cn-migration-plan";
import { binding, fixture } from "./cn-migration-snapshot.fixture";
const cli=fileURLToPath(new URL("../src/cn-migration-plan-cli.ts",import.meta.url));
it("real CLI refuses incomplete snapshots before source import; complete snapshot binds proof into canonical plan",()=>{
 const dir=mkdtempSync(join(tmpdir(),"snapshot-cli-"));
 const git=(...args:string[])=>execFileSync("git",["-C",dir,...args],{encoding:"utf8"}).trim();
 const input=join(dir,"snapshot.json"),expected=join(dir,"binding.json");
 try {
  mkdirSync(join(dir,"apps/api/src/infrastructure/db"),{recursive:true});mkdirSync(join(dir,"apps/api/migrations"),{recursive:true});
  writeFileSync(join(dir,"package.json"),'{"type":"module"}');
  writeFileSync(join(dir,"apps/api/src/infrastructure/db/migrator.ts"),'import { readdirSync } from "node:fs"; export const migrationFiles=(d:string)=>readdirSync(d).filter(n=>n.endsWith(".sql")).sort();');
  const sql="CREATE TABLE fixture (id integer);";writeFileSync(join(dir,"apps/api/migrations/0001_fixture.sql"),sql);
  git("init","-q");git("add","package.json","apps");git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-qm","synthetic migration source");
  const target=git("rev-parse","HEAD");const f=fixture([{name:"0001_fixture.sql",checksum:migrationHash(sql)}]);
  writeFileSync(expected,JSON.stringify(binding),{mode:0o600});writeFileSync(input,JSON.stringify(f.snapshot),{mode:0o600});
  const args=["--import","tsx",cli,dir,target,"b".repeat(40),input,expected];
  const plan=JSON.parse(execFileSync(process.execPath,args,{encoding:"utf8"}));
  expect(plan.ready).toBe(true);expect(plan.productionMigrationAuthorized).toBe(false);
  expect(plan.snapshotEvidence.independentSqlCount).toBe(1);expect(plan.snapshotEvidence.ledgerSha256).toBe(plan.baselineLedgerSha256);
  f.sql.independentSqlCount=255;f.seal();writeFileSync(input,JSON.stringify(f.snapshot));
  try{execFileSync(process.execPath,args,{encoding:"utf8",stdio:"pipe"});throw new Error("unexpected success");}
  catch(error){const e=error as {status?:number;stdout?:string;stderr?:string};expect(e.status).toBe(2);expect(e.stdout).toBe("");expect(e.stderr).toBe("MIGRATION_SNAPSHOT_COUNT_MISMATCH\n");}
 } finally{rmSync(dir,{recursive:true,force:true});}
});
