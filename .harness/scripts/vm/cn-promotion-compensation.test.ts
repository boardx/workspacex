import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
const workflow=readFileSync(new URL("../../../.github/workflows/promote-cn-production.yml",import.meta.url),"utf8");
const start=workflow.indexOf("          activated=0",workflow.indexOf("Activate, browser-verify"));
const end=workflow.indexOf('          sudo -n /usr/local/bin/workspacex-cn-deploy "${REVISION}"',start);
const criticalSection=workflow.slice(start,end).split("\n").map(line=>line.slice(10)).join("\n");
function run(body:string){
 return spawnSync("bash",["-c",`set -euo pipefail
REVISION=new; EXPECTED_MAIN_CN=old; ATTEMPT_ID=attempt; cache=cache; repository=repo
sudo(){ echo "SUDO:$*"; }
git(){
 case "$*" in
  *"rev-parse refs/heads/main-cn"*) echo old;;
  *"update-ref refs/heads/main-cn new old"*) echo LOCAL_ADVANCED;;
  *"update-ref refs/heads/main-cn old new"*) echo LOCAL_RESTORED;;
  *"fetch --no-tags origin main main-cn"*) echo FETCH_FAILED; return 1;;
 esac
}
${body}`],{encoding:"utf8"});
}
it("registers real compensation before local mutation; fetch failure restores the mirror",()=>{
 const result=run(criticalSection);
 expect(result.status).toBe(1);
 expect(result.stdout).toContain("LOCAL_ADVANCED");
 expect(result.stdout).toContain("LOCAL_RESTORED");
 expect(result.stdout).not.toContain("SUDO:");
});
it("does not rollback an accepted runtime when GitHub CAS response is ambiguous",()=>{
 const trapEnd=criticalSection.indexOf("trap rollback EXIT")+"trap rollback EXIT".length;
 const result=run(criticalSection.slice(0,trapEnd)+"\nactivated=1; remote_commit_attempted=1; false");
 expect(result.status).toBe(1);
 expect(result.stdout).not.toContain("LOCAL_RESTORED");
 expect(result.stdout).not.toContain("SUDO:");
 expect(result.stdout).toContain("CN_REMOTE_CAS_OUTCOME_REQUIRES_RECONCILIATION");
});
it("rolls back runtime and mirror on a proven pre-CAS failure",()=>{
 const trapEnd=criticalSection.indexOf("trap rollback EXIT")+"trap rollback EXIT".length;
 const result=run(criticalSection.slice(0,trapEnd)+"\nactivated=1; false");
 expect(result.status).toBe(1);
 expect(result.stdout).toContain("--rollback new attempt");
 expect(result.stdout).toContain("LOCAL_RESTORED");
});
