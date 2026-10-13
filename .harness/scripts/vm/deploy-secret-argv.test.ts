import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
const root = resolve(import.meta.dirname, "../../..");
const vm = join(root, ".harness/scripts/vm");
const deploy = readFileSync(join(vm, "deploy.sh"), "utf8");
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function argvExpansions(text: string): string[] {
  return text.split("\n").filter(line => !/^\s*#/.test(line) && /(?:env|export)\s+\$\([^\n]*ENV_FILE/.test(line));
}
it("deploy/provision contain no env-file expansion into argv; restoring the old pattern fails the gate", () => {
  expect(argvExpansions(deploy)).toEqual([]);
  expect(argvExpansions(readFileSync(join(vm, "provision.sh"), "utf8"))).toEqual([]);
  expect(argvExpansions('sudo -u "$RUN_AS" env $(grep -v \'^#\' "$ENV_FILE" | xargs) pnpm')).toHaveLength(1);
  expect(deploy).not.toMatch(/-c\s+"ALTER ROLE[^\n]*PASSWORD/);
});
it("loads synthetic credentials after sudo without putting them in captured argv", () => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-argv-")); temps.push(dir);
  const envFile = join(dir, "deploy.env"), argvFile = join(dir, "argv"), probe = join(dir, "probe.mjs"), resultFile = join(dir, "result.json");
  const secret = "fake-password-with-space $not_expanded";
  writeFileSync(envFile, `APP_DB_PASSWORD=${quote(secret)}\nKERNEL_MODEL_API_KEY='fake-model-token'\n`);
  writeFileSync(join(dir, "sudo"), '#!/bin/bash\nprintf "%s\\0" "$@" >> "$ARGV_FILE"\nshift 2\nexec "$@"\n'); chmodSync(join(dir, "sudo"), 0o755);
  writeFileSync(probe, 'import {writeFileSync} from "node:fs"; writeFileSync(process.argv[2], JSON.stringify({ password:process.env.APP_DB_PASSWORD, key:process.env.KERNEL_MODEL_API_KEY, argv:process.argv, inherited:process.env.SUDO_COMMAND, override:process.env.NODE_ENV }));');
  const helper = deploy.match(/run_deploy_env\(\) \{[\s\S]*?\n\}/)?.[0]; expect(helper).toBeDefined();
  const run = spawnSync("bash", ["-euo", "pipefail", "-c", `${helper}\nrun_deploy_env env NODE_ENV=production ${quote(process.execPath)} ${quote(probe)} ${quote(resultFile)}`], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ENV_FILE: envFile, RUN_AS: "test-user", ARGV_FILE: argvFile, SUDO_COMMAND: "inherited-sensitive-command" }, encoding:"utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  const result = JSON.parse(readFileSync(resultFile, "utf8"));
  expect(result.password).toBe(secret); expect(result.key).toBe("fake-model-token"); expect(result.override).toBe("production"); expect(result.inherited).toBeUndefined();
  const args = readFileSync(argvFile, "utf8") + JSON.stringify(result.argv);
  expect(args).not.toContain(secret); expect(args).not.toContain("fake-model-token"); expect(args).toContain(envFile);
});
it.each(["synthetic'password", "synthetic''end'", "synthetic\\$& spaced", "synthetic\n'line\n"])("password SQL preserves characters and keeps %j out of docker argv", (password) => {
  const dir = mkdtempSync(join(tmpdir(), "deploy-sql-")); temps.push(dir);
  const argvFile = join(dir, "argv"), sqlFile = join(dir, "sql");
  writeFileSync(join(dir, "docker"), '#!/bin/bash\nprintf "%s\\0" "$@" > "$ARGV_FILE"\ncat > "$SQL_FILE"\n'); chmodSync(join(dir, "docker"), 0o755);
  const replacement = deploy.match(/^sql_quote_replacement=.*$/m)?.[0]; expect(replacement).toBeDefined();
  for (const [role, key] of [["app_rw", "APP_DB_PASSWORD"], ["app_diag_ro", "DIAG_DB_PASSWORD"]]) {
    const snippet = deploy.match(new RegExp(`printf "ALTER ROLE ${role} PASSWORD[^\\n]*\\n[^\\n]*docker exec[^\\n]*`))?.[0]; expect(snippet).toBeDefined();
    const run = spawnSync("bash", ["-euo", "pipefail", "-c", `${replacement}\n${snippet}`], { env: { ...process.env, PATH:`${dir}:${process.env.PATH}`, [key!]:password, ARGV_FILE:argvFile, SQL_FILE:sqlFile }, encoding:"utf8" });
    expect(run.status, run.stderr).toBe(0); expect(readFileSync(sqlFile,"utf8")).toBe(`ALTER ROLE ${role} PASSWORD '${password.replaceAll("'", "''")}';\n`);
    expect(readFileSync(argvFile,"utf8")).not.toContain("synthetic"); expect(readFileSync(argvFile,"utf8")).toContain("ON_ERROR_STOP=1");
  }
});
it("shared scrubSecrets redacts exact environment values and token shapes from diagnostics", () => {
  const run = spawnSync("bash", ["-euo", "pipefail", "-c", `source ${quote(join(vm,"deploy-readiness.sh"))}\nprintf '%s\\n' 'unlabelled synthetic-secret-value' 'TOKEN=fake-visible-token' | redact_deploy_diagnostics`], { env:{...process.env, APP_DIR:root, MODEL_CREDENTIAL_KEY:"synthetic-secret-value"}, encoding:"utf8" });
  expect(run.status,run.stderr).toBe(0); expect(run.stdout).not.toContain("synthetic-secret-value"); expect(run.stdout).not.toContain("fake-visible-token"); expect(run.stdout).toContain("<redacted>");
});
