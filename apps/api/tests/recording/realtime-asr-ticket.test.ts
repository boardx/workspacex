import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import type {NestExpressApplication} from "@nestjs/platform-express";
import {personalRealtimeTranscription as C} from "@repo/contracts";
import { InMemoryRealtimeAsrTicketStore } from "../../src/infrastructure/recording/in-memory-realtime-asr-ticket-store";
import {addOrgMember,ensureDatabase,migrateOnce,resetOrgs,seedOrg} from "../support/db";
process.env.KERNEL_ALLOW_TEST_PRINCIPAL="1";process.env.KERNEL_QUIET="1";
process.env.KERNEL_ASR_PROVIDER="dashscope";
process.env.KERNEL_ASR_BASE_URL="ws://127.0.0.1:1";
process.env.KERNEL_ASR_API_KEY="test-key";
process.env.KERNEL_ASR_MODEL="qwen3-asr-flash-realtime";
const ORG="org-realtime-asr-ticket",PROJECT="project-realtime-asr-ticket",USER="user-realtime-asr-ticket";
const auth={"x-kernel-test-principal":`${USER}:${ORG}`};let app:NestExpressApplication,baseUrl:string;
beforeAll(async()=>{ensureDatabase();await migrateOnce();const {createApp}=await import("../../src/main");app=await createApp();await app.listen(0);
  const address=app.getHttpServer().address();baseUrl=`http://127.0.0.1:${typeof address==="object"&&address?address.port:0}`;});
afterAll(async()=>{await app?.close();await resetOrgs(ORG);});
beforeEach(async()=>{await resetOrgs(ORG);const f=await seedOrg({orgId:ORG,projectId:PROJECT});await addOrgMember(ORG,USER,"consultant",f.teams.energy!);});

describe("personal realtime ASR tickets", () => {
  it("creates a capture and issues a 60 second ticket through authenticated HTTP",async()=>{
    const created=await fetch(`${baseUrl}/recording/realtime-asr/sessions`,{method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify({name:"实时",tags:["客户"]})});
    expect(created.status).toBe(201);const summary=C.operations.createPersonalTranscription.out.parse(await created.json());
    const response=await fetch(`${baseUrl}/recording/realtime-asr/sessions/${summary.sessionId}/tickets`,{method:"POST",headers:auth});
    expect(response.status).toBe(201);const issued=C.operations.issueRealtimeAsrTicket.out.parse(await response.json());
    expect(issued.websocketPath).toContain(`/sessions/${summary.sessionId}/captures/${issued.captureId}/stream`);
    expect(Date.parse(issued.expiresAt)-Date.now()).toBeGreaterThan(50_000);
    const detail=await fetch(`${baseUrl}/recording/realtime-asr/sessions/${summary.sessionId}`,{headers:auth});
    expect(C.operations.readPersonalTranscription.out.parse(await detail.json())).toMatchObject({
      sessionId:summary.sessionId,status:"recording",content:""});
    const edit=await fetch(`${baseUrl}/recording/realtime-asr/sessions/${summary.sessionId}/content`,{
      method:"PATCH",headers:{...auth,"content-type":"application/json"},body:JSON.stringify({content:"录音中禁止覆盖"})});
    expect(edit.status).toBe(409);expect(await edit.json()).toMatchObject({reasonCode:"CAPTURE_ALREADY_ACTIVE"});
  });
  it("are scoped, expire, and can be consumed only once", async () => {
    let now = 1_000;
    const store = new InMemoryRealtimeAsrTicketStore(() => now);
    const issued = await store.issue({
      ticket: "secret", ticketHash: "hash", orgId: "org" as never, ownerUserId: "user",
      transcriptionId: "tx", captureId: "capture", expiresAtMs: 61_000,
    });
    expect(issued.captureId).toBe("capture");
    await expect(store.consume({ ticketHash: "hash", orgId: "org" as never, transcriptionId: "other", captureId: "capture" }))
      .resolves.toEqual({ ok: false, reason: "TICKET_INVALID" });
    await expect(store.consume({ ticketHash: "hash", orgId: "org" as never, transcriptionId: "tx", captureId: "capture" }))
      .resolves.toMatchObject({ ok: true, ownerUserId: "user" });
    await expect(store.consume({ ticketHash: "hash", orgId: "org" as never, transcriptionId: "tx", captureId: "capture" }))
      .resolves.toEqual({ ok: false, reason: "TICKET_USED" });

    await store.issue({ ticket: "later", ticketHash: "later-hash", orgId: "org" as never,
      ownerUserId: "user", transcriptionId: "tx", captureId: "later-capture", expiresAtMs: 61_000 });
    now = 61_001;
    await expect(store.consume({ ticketHash: "later-hash", orgId: "org" as never, transcriptionId: "tx", captureId: "later-capture" }))
      .resolves.toEqual({ ok: false, reason: "TICKET_EXPIRED" });
  });
});
