import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
const read=(name:string)=>readFileSync(new URL(name,import.meta.url),"utf8");
const build=read("build-cn-release-candidate.sh"),deploy=read("deploy-cn-production.sh"),collector=read("collect-cn-release-preflight.sh");
it("prepares an attempt-owned config before any aggregate collector/build without changing active config",()=>{
 expect(build.indexOf("cn-candidate-config-cli.ts prepare")).toBeLessThan(build.indexOf('"$PREFLIGHT_COLLECTOR" prebuild'));
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
