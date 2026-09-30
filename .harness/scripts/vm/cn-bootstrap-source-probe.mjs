// Load Docker raw env format without shell evaluation or exposing credentials.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const [envFile, repository, phase, sourceSha, imageDigest] = process.argv.slice(2);
if (!envFile || !repository || !["prebuild", "preactivate"].includes(phase) || !/^[a-f0-9]{40}$/.test(sourceSha)) process.exit(2);
const environment = { ...process.env };
for (const line of fs.readFileSync(envFile,"utf8").trimEnd().split("\n")) {
  const index=line.indexOf("=");
  if (index<1 || !/^[A-Z][A-Z0-9_]*$/.test(line.slice(0,index))) process.exit(2);
  environment[line.slice(0,index)]=line.slice(index+1);
}
environment.CN_BOOTSTRAP_PHASE=phase; environment.CN_BOOTSTRAP_SOURCE_SHA=sourceSha;
if(imageDigest) environment.CN_BOOTSTRAP_IMAGE_DIGEST=imageDigest;
const result=spawnSync(process.execPath,["--import","tsx","scripts/provision-admin-compatibility.ts"],{
  cwd: repository+"/apps/api", env:environment, encoding:"utf8",timeout:45000,maxBuffer:65536,
});
// Raw provider/database errors are never propagated. The CLI owns redaction.
if(result.error){process.stderr.write("BOOTSTRAP_PROBE_TIMEOUT\n");process.exit(1);}
process.stdout.write(result.stdout ?? "");
process.exit(result.status ?? 1);
