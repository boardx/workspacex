import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
const read=(name:string)=>readFileSync(new URL(name,import.meta.url),"utf8");
const build=read("build-cn-release-candidate.sh"),deploy=read("deploy-cn-production.sh"),collector=read("collect-cn-release-preflight.sh");
it("prepares an attempt-owned config before any aggregate collector/build without changing active config",()=>{
 const prepare=build.indexOf("cn-candidate-config-cli.ts prepare");
 const collect=build.indexOf('"$PREFLIGHT_COLLECTOR" "$preflight_phase"');
 expect(prepare).toBeGreaterThan(-1);
 expect(collect).toBeGreaterThan(prepare);
 for(const source of [deploy,collector])expect(source).toContain('CONFIG_FILE="/etc/workspacex-cn/candidate-configs/$revision/$attempt_id/deployment.json"');
 expect(build).not.toContain("candidate-config-cli.ts commit");
 expect(collector).not.toContain("candidate-config-cli.ts commit");
});
it("commits config only after browser acceptance and restores it with the runtime",()=>{
 const browser=deploy.lastIndexOf('|| fail "browser smoke failed"');
 const commit=deploy.indexOf("candidate_config_action commit");
 expect(commit).toBeGreaterThan(browser);
 expect(commit).toBeLessThan(deploy.lastIndexOf("activation_started=0"));
 const restore=deploy.slice(deploy.indexOf("restore_baseline()"),deploy.indexOf("enable_run_drain()"));
 expect(restore).toContain("candidate_config_action restore");
 expect(restore.indexOf("candidate_config_action restore")).toBeLessThan(restore.indexOf("docker compose -p"));
});
it("direct CLI child inherits the held fd 9 across a cwd-only subshell",()=>{
 const script='exec 9>/tmp/wsx-cn-lock-fd-test-$$; (cd /tmp; test -e /dev/fd/9); result=$?; rm -f /tmp/wsx-cn-lock-fd-test-$$; exit $result';
 expect(spawnSync("bash",["-c",script]).status).toBe(0);
 expect(deploy).toContain('(cd "$release_checkout"; node --import tsx');
});
it("all trusted callers establish private root lock metadata before invoking the config CLI",()=>{
 for(const source of [build,deploy,read("verify-cn-release-promotion.sh")]){
  expect(source).toContain('chown root:root "$RUNTIME_ROOT/release.lock"; chmod 0600 "$RUNTIME_ROOT/release.lock"');
 }
});

it("selects prebuild by default and artifact-build only for the trusted build-only mode",()=>{
 const start=build.indexOf("preflight_phase=prebuild");
 const end=build.indexOf("# A fresh schema-v2",start);
 expect(start).toBeGreaterThan(-1);
 expect(end).toBeGreaterThan(start);
 const selection=build.slice(start,end);
 for(const [mode,phase] of [["0","prebuild"],["1","artifact-build"]]){
  const result=spawnSync("bash",["-eu","-c",`${selection}printf '%s' "$preflight_phase"`],{env:{...process.env,build_only:mode},encoding:"utf8"});
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(phase);
 }
 expect(build).toContain("build_only=0");
 expect(build).toContain('if [[ ${1:-} == --build-only ]]; then');
 const binding=build.indexOf('CN_BUILD_TOOL_ROOT=$(python3');
 expect(binding).toBeGreaterThan(-1);
 expect(binding).toBeLessThan(start);
 expect(build.slice(binding,start)).toContain('"$tool_binding" "$revision" "$release" "$attempt_id" prebuild) || exit 1');
});
