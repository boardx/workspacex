/** Two actual Nest instances and shared PG. This is not OS restart or duration evidence. */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AGENT_RUN_STORE, type AgentRunStore } from "../../src/application/agent-run/ports";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const ORG = "org-s3-instance", PROJECT = "project-s3-instance", ACTOR = "actor-s3-instance";
const apps: NestExpressApplication[] = [];
const bases: string[] = [];
let store: AgentRunStore;
beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  const { createApp } = await import("../../src/main");
  for (let i = 0; i < 2; i++) {
    const app = await createApp(); apps.push(app); await app.listen(0);
    const address = app.getHttpServer().address();
    bases.push(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`);
  }
  store = apps[1]!.get(AGENT_RUN_STORE);
}, 180_000);
afterAll(async () => { for (const app of apps) await app.close(); });
it("resumes a durable cursor on another instance and rejects subsequent tail reads after actual membership revocation", async () => {
  await resetOrgs(ORG); await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  const thread = randomUUID(), message = randomUUID(), run = randomUUID();
  // Another creator ensures project membership, rather than creator access, grants this reader access.
  await addChatThread({ orgId: ORG, id: thread, projectId: PROJECT, visibilityScope: "plenary", createdBy: "different-creator" });
  await addChatMessage({ orgId: ORG, id: message, threadId: thread, body: "journal instance test", authorId: "different-creator" });
  await asApp(ORG, c => c.query(`INSERT INTO agent_runs
    (id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,paused_at)
    VALUES ($1,$2,$3,$4,'s3-agent','s3-version','[]','deep-agent','deep-agent','paused',now())`, [run, ORG, thread, message]));
  const read = (index: number, after = -1) => fetch(`${bases[index]}/agent-runs/${run}/execution-events?afterSeq=${after}`,
    { headers: { "x-kernel-test-principal": `${ACTOR}:${ORG}` } });
  const append = (delta: string) => store.appendExecutionEvent!(toOrgId(ORG), run,
    { kind: "text_delta", messageId: "public-progress", attemptId: "instance-attempt", delta });
  await append("before disconnect");
  const firstResponse = await read(0); expect(firstResponse.status).toBe(200);
  const first = await firstResponse.json() as { events: { seq: number; delta?: string }[]; nextSeq: number };
  expect(first.events.at(-1)?.delta).toBe("before disconnect");
  expect(first.nextSeq).toBe(first.events.at(-1)?.seq);
  await apps[0]!.close();
  const { createApp } = await import("../../src/main");
  const rebuilt = await createApp(); apps[0] = rebuilt; await rebuilt.listen(0);
  const rebuiltAddress = rebuilt.getHttpServer().address();
  bases[0] = `http://127.0.0.1:${typeof rebuiltAddress === "object" && rebuiltAddress ? rebuiltAddress.port : 0}`;
  await append("after disconnect");
  const resumedResponse = await read(1, first.nextSeq); expect(resumedResponse.status).toBe(200);
  const resumed = await resumedResponse.json() as { events: { seq: number; delta?: string }[]; nextSeq: number };
  expect(resumed.events).toHaveLength(1);
  expect(resumed.events[0]).toMatchObject({ seq: first.nextSeq + 1, delta: "after disconnect" });
  expect(await store.readExecutionEvents!(toOrgId(ORG), run, first.nextSeq)).toEqual(resumed.events);
  expect(await (await read(1, resumed.nextSeq)).json()).toMatchObject({ events: [], nextSeq: null });
  await asApp(ORG, c => c.query("DELETE FROM project_memberships WHERE org_id=$1 AND project_id=$2 AND user_id=$3", [ORG, PROJECT, ACTOR]));
  await append("must remain private after revoke");
  for (const index of [0, 1]) {
    const denied = await read(index, resumed.nextSeq);
    expect(denied.status).toBe(404);
    expect(await denied.text()).not.toContain("must remain private after revoke");
  }
});
