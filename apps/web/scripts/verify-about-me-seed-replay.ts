/** #6174: actual supported KG fixture initialization twice in one isolated DB, without Next. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import config from "../playwright.fullstack-smoke.config";
assert(Array.isArray(config.webServer));
const api=config.webServer.find(server=>server.command.includes("scripts/seed-fullstack-smoke.ts"));
assert(api?.env?.FULLSTACK_ABOUT_ME_FIXTURE,"official About me fixture must be enabled");
const commands=api.command.split(" && ");assert(commands.length===3&&commands[2]!.includes("start-fullstack-smoke-api.ts"));
for(const [index,command] of [commands.slice(0,2).join(" && "),commands[1]!].entries()) {
 const result=spawnSync("/bin/sh",["-c",command],{cwd:process.cwd(),env:{...process.env,...api.env},stdio:"inherit"});
 process.stdout.write(`[about-me-seed-replay] seed${index+1} exit=${result.status}\n`);if(result.status!==0)process.exit(result.status??1);
}
process.stdout.write("[about-me-seed-replay] canonical KG fixture repeat succeeded; no API/Next/model started\n");
