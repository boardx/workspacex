import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
const workflow=readFileSync(new URL("../../../.github/workflows/promote-cn-production.yml",import.meta.url),"utf8");
const start=workflow.indexOf("          activated=0",workflow.indexOf("Activate, browser-verify"));
const end=workflow.indexOf("          # CN_LOCAL_PROMOTION_PREACTIVATION_END",start);
const criticalSection=workflow.slice(start,end).split("\n").map(line=>line.slice(10)).join("\n");
function run(body:string){
 return spawnSync("bash",["-c",`set -euo pipefail
REVISION=new; EXPECTED_MAIN_CN=old; ATTEMPT_ID=attempt; cache=cache; repository=repo; app_runtime_state=ready
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
it("a verified matching intent compensates safely if local reconciliation fails",()=>{
 const result=run('RELEASE_MODE=app-only; app_runtime_state=verified\n'+criticalSection);
 expect(result.status).toBe(1);
 expect(result.stdout).toContain("--app-only-rollback new attempt");
 expect(result.stdout).toContain("LOCAL_RESTORED");
});
it("CAS reconciliation skips a second switch but a fresh app release switches once",()=>{
 const marker=workflow.indexOf("# CN_LOCAL_PROMOTION_PREACTIVATION_END");
 const end=workflow.indexOf("          activated=1",marker);
 const activation=workflow.slice(marker,end).split("\n").map(line=>line.startsWith("          ")?line.slice(10):line).join("\n");
 expect(end).toBeGreaterThan(marker);
 for(const state of ["ready","verified"]){
  const result=run(`RELEASE_MODE=app-only; app_runtime_state=${state}\n`+activation);
  expect(result.status,result.stderr).toBe(0);
  expect((result.stdout.match(/SUDO:/g)||[]).length).toBe(state==="ready"?1:0);
 }
});
it("expired readonly intent verification cannot initiate a late remote CAS",()=>{
 const start=workflow.indexOf('          if [[ "${RELEASE_MODE:-standard}" == app-only ]]; then\n            publication=');
 const end=workflow.indexOf('          node - "${graphql_input}.response"',start);
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const block=workflow.slice(start,end).split("\n").map(line=>line.slice(10)).join("\n");
 const result=run(`RELEASE_MODE=app-only; remote_commit_attempted=0; graphql_input=$(mktemp)
sudo(){ printf '%s' '{"status":"verified","publicationWindowOpen":false,"publicationDeadline":"2000-01-01T00:00:00.000Z"}'; }
gh(){ echo FORBIDDEN_REMOTE_CAS; }
trap 'echo REMOTE_ATTEMPT:$remote_commit_attempted; rm -f "$graphql_input" "$graphql_input.response"' EXIT
${block}`);
 expect(result.status).toBe(1);expect(result.stdout).toContain("REMOTE_ATTEMPT:0");
 expect(result.stdout).not.toContain("FORBIDDEN_REMOTE_CAS");
});
