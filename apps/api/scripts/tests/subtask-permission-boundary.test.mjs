import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { checkSubtaskPermissionBoundary } from "../lib/subtask-permission-boundary.mjs";

const api = fileURLToPath(new URL("../../", import.meta.url));
const read = path => readFileSync(resolve(api,path),"utf8");
const storePath = "src/infrastructure/agent-run/pg-subtask-run-store.ts";
const executorPath = "src/infrastructure/agent-run/subtask-run-executor.ts";
const store = read(storePath), executor = read(executorPath);
const controller = read("src/interface/controllers/subtask-run.controller.ts");
const authorization = read("src/application/agent-run/authorize-subtask-parent.ts");
const inspect = (path, source, control = controller, auth = authorization) => checkSubtaskPermissionBoundary(path,source,control,auth);

test("current exact system/disclosure boundaries satisfy the exception", () => {
  assert.deepEqual(inspect(storePath,store),[]);
  assert.deepEqual(inspect(executorPath,executor),[]);
});
test("counterproof: losing tenant SQL predicates or transaction scope fails", () => {
  assert.notEqual(inspect(storePath,store.replaceAll("org_id=$1","TRUE")).length,0);
  assert.notEqual(inspect(storePath,store.replaceAll("this.db.withTenant(orgId","this.db.withoutTenant(")).length,0);
});
test("counterproof: a second tenant table is not included in the exception", () => {
  assert.notEqual(inspect(storePath,store.replace("SELECT * FROM subtask_runs","SELECT * FROM chat_messages")).length,0);
});
test("counterproof: unpinned or cross-org parent version join fails", () => {
  assert.notEqual(inspect(executorPath,executor.replace("v.id=r.agent_version_id","v.agent_id=r.agent_id")).length,0);
  assert.notEqual(inspect(executorPath,executor.replace("v.org_id=r.org_id","TRUE")).length,0);
});
test("counterproof: missing parent authorization before list or retry fails", () => {
  for (const write of [false,true]) {
    const changed = controller.replace(`await this.authorizeParent(principal,runId,${write});`,"");
    assert.notEqual(inspect(storePath,store,changed).length,0);
  }
});
test("counterproof: allowing denied visibility or bypassing the shared decision fails", () => {
  assert.notEqual(inspect(storePath,store,controller,authorization.replace('if (outcome.kind !== "allow") throw new AgentRunNotVisibleError();',"")).length,0);
  assert.notEqual(inspect(storePath,store,controller,authorization.replace("await resolveVisibility(","await unrelatedVisibility(")).length,0);
});
test("counterproof: tools or parent remote thread reuse are not permitted", () => {
  assert.notEqual(inspect(executorPath,executor.replace('executionMode: "text-only"','executionMode: "native"')).length,0);
  assert.notEqual(inspect(executorPath,executor.replace("history: []","threadId: run.parentRunId, history: []")).length,0);
});
