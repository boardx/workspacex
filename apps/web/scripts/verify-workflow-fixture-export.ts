/** Actual PostgreSQL seed using workflow values exclusively from e2e-up's exporter; no API/Next/model. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import config from "../playwright.fullstack-smoke.config";
import { readFixtureExports } from "../e2e/fixture-env-reader";
assert(Array.isArray(config.webServer));
const api=config.webServer.find(server=>server.command.includes("scripts/seed-fullstack-smoke.ts"));assert(api?.env);
const dumped=spawnSync("pnpm",["exec","tsx","e2e/dump-fixture-env.ts"],{cwd:process.cwd(),env:process.env,encoding:"utf8"});assert.equal(dumped.status,0,"fixture exporter failed");
const values=readFixtureExports(dumped.stdout);const env:NodeJS.ProcessEnv={...process.env,...api.env};
for(const key of Object.keys(env)) if(key.startsWith("FULLSTACK_E2E_WORKFLOW_RUNS_")) delete env[key];
const seed=readFileSync(resolve(process.cwd(),"../api/scripts/seed-fullstack-smoke.ts"),"utf8");
const required=[...seed.matchAll(/required\("(FULLSTACK_E2E_WORKFLOW_RUNS_[A-Z_]+)"\)/g)].map(m=>m[1]!);assert(required.length>0);
for(const key of required) { assert(typeof values[key]==="string"&&values[key]!=="",`export missing ${key}`);env[key]=values[key]; }
const commands=api.command.split(" && ");assert(commands.length===3&&commands[2]!.includes("start-fullstack-smoke-api.ts"));
for(const [index,command] of [commands.slice(0,2).join(" && "),commands[1]!].entries()) {
 const result=spawnSync("/bin/sh",["-c",command],{cwd:process.cwd(),env,stdio:"inherit"});process.stdout.write(`[workflow-export-seed] seed${index+1} exit=${result.status}\n`);if(result.status!==0)process.exit(result.status??1);
}
process.stdout.write(`[workflow-export-seed] ${required.length} workflow variables from shared exporter; two same-DB seeds succeeded; other service config from Playwright; no API/Next/model started\n`);
