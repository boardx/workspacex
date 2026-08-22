import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { interview as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { assembleFromRecorded } from "../../src/application/context-pack/replay-pack";
import { packContentHash } from "../../src/domain/context-pack/pack-hash";
import type { RecordedRun } from "../../src/domain/context-pack/recorded-run";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const ORG = "org-itv-f03", OTHER = "org-itv-f03-other", USER = "u-itv-f03";
const AGENT = "agent-itv-f03", PROVIDER = "itv-f03-loopback", MODEL = "itv-f03-model";
let app: NestExpressApplication, base = "", provider: Server, providerBase = "";
let providerMessages: {role:string;content:string}[] = [];
let providerHook: (() => Promise<void>) | null = null;
const auth = { "x-kernel-test-principal": `${USER}:${ORG}`, "content-type": "application/json" };
const startBody = (requestId: string) => JSON.stringify({ expertId: AGENT, requestId });
const maskTrace = (raw: string) => raw.replace(/"traceId":"[^"]+"/, '"traceId":"<masked>"');

beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  provider = createServer((req, res) => { const chunks: Buffer[] = []; req.on("data", c => chunks.push(c)); req.on("end", async () => {
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { messages: { role: string; content: string }[] };
    providerMessages = body.messages;
    await providerHook?.();
    const question = body.messages.at(-1)?.content ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: `专家回答：${question}` } }] }));
  }); });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  providerBase = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
  process.env.KERNEL_MODEL_PROVIDER = PROVIDER; process.env.KERNEL_MODEL_BASE_URL = providerBase;
  process.env.KERNEL_MODEL_API_KEY = "test-key";
  const { createApp } = await import("../../src/main"); app = await createApp(); await app.listen(0);
  const address = app.getHttpServer().address(); base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180_000);

afterAll(async () => { await app?.close(); await resetOrgs(ORG, OTHER); if (provider) await new Promise<void>(r => provider.close(() => r())); });

beforeEach(async () => {
  providerMessages = []; providerHook = null;
  await resetOrgs(ORG, OTHER); const fx = await seedOrg({ orgId: ORG, projectId: "proj-f03" });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!); const otherFx=await seedOrg({ orgId: OTHER, projectId: "proj-other" });
  await addOrgMember(OTHER, "other", "consultant", otherFx.teams.energy!);
  await asApp(ORG, async c => {
    await c.query(`INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,initials,role,visibility,source,publish_state,model_id,concurrency_limit,degrade_policy)
      VALUES ($1,$2,$1,'德国采购总监','enabled',$3,now(),now(),'DE','采购决策','全组织可用','self','运行中',$4,2,'跟随组织级')`, [AGENT, ORG, USER, MODEL]);
    await c.query(`INSERT INTO agent_versions (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES ('av-f03',$1,$2,'v1',$3,'从采购决策视角回答',ARRAY[]::text[],$4,$5,'[]'::jsonb,$6,now(),now())`, [ORG, AGENT, createHash("sha256").update("从采购决策视角回答").digest("hex"), PROVIDER, MODEL, USER]);
    await c.query(`UPDATE agents SET published_version_id='av-f03' WHERE org_id=$1 AND id=$2`, [ORG, AGENT]);
    await c.query(`INSERT INTO capability_listings (id,org_id,kind,name,scope,enabled,abbr,duty,role_label) VALUES ($1,$2,'agent','德国采购总监','org-wide',true,'DE','采购决策','采购总监')`, [AGENT, ORG]);
  });
});

async function bindContextMaterial(runId: string) {
  const recorded: RecordedRun = {
    runId, packId:`${runId}-pack`, orgId:ORG,
    query:{tenantId:ORG,principalId:USER,projectIds:[],task:"decision-support",query:"采购否决权",timeRange:null,allowedSensitivity:["internal"],tokenBudget:1000,freshnessRequirement:null,evidencePolicy:"all"},
    retrievalPlan:[{channel:"fts",weight:1,hitCount:1}],
    candidates:[{segmentId:"seg-f03-material",content:"材料事实：财务与技术共同掌握采购否决权。",sourceType:"file",artifactVersionId:"artifact-version-f03",anchor:{page:1},retrievalReasons:["recall"],channels:["fts"],score:0.9,permissionDecisionId:"decision-f03",relevance:0.9,relevanceProvenance:"fixture",tokens:20,fingerprint:"f03-material",confidential:false}],
    withheld:[],unanchorable:[],claims:[],thresholdUsed:0.45,
  };
  const hash=packContentHash(assembleFromRecorded(recorded,null));
  await asApp(ORG, async c => {
    await c.query(`INSERT INTO context_packs(run_id,org_id,status,recorded,content_hash,threshold_used) VALUES($1,$2,'assembled',$3::jsonb,$4,$5)`,[runId,ORG,JSON.stringify(recorded),hash,recorded.thresholdUsed]);
    await c.query(`UPDATE digital_expert_profiles SET material_context_pack_id=$3,material_version='v1' WHERE org_id=$1 AND agent_id=$2`,[ORG,AGENT,runId]);
  });
}

describe("F03 快捷数字专家访谈 HTTP", () => {
  it("创建即进入历史，问答持久化且明确为探索性", async () => {
    const start = await fetch(`${base}/interviews/digital/quick`, { method: "POST", headers: auth, body: startBody("start-1") });
    expect(start.status).toBe(201); const quick = C.operations.startQuickDigitalInterview.out.parse(await start.json());
    const answer = await fetch(`${base}/interviews/digital/quick/${quick.interviewId}/messages`, { method: "POST", headers: auth, body: JSON.stringify({ interviewId: quick.interviewId, text: "谁有采购否决权？", expectedVersion: quick.version }) });
    expect(answer.status).toBe(201); const saved = C.operations.appendQuickDigitalInterviewMessage.out.parse(await answer.json());
    expect(saved.messages.map(m => m.role)).toEqual(["user", "assistant"]); expect(saved.messages[1]).toMatchObject({ text: "专家回答：谁有采购否决权？", exploratory: true, sourcePointers:["agent-version:av-f03"] });
    const history = await fetch(`${base}/interviews/digital`, { headers: auth }); expect(await history.json()).toMatchObject({items:[{interviewId:quick.interviewId,kind:"quick"}]});
  });

  it("同一 requestId 重试只创建一条历史访谈", async () => {
    const responses = await Promise.all([1, 2].map(() => fetch(`${base}/interviews/digital/quick`, {
      method: "POST", headers: auth, body: startBody("retry-safe-start"),
    })));
    const a = responses[0]!; const b = responses[1]!;
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    const first = C.operations.startQuickDigitalInterview.out.parse(await a.json());
    const second = C.operations.startQuickDigitalInterview.out.parse(await b.json());
    expect(second.interviewId).toBe(first.interviewId);
    const history = await (await fetch(`${base}/interviews/digital`, { headers: auth })).json() as {items:{interviewId:string}[]};
    expect(history.items.filter(item => item.interviewId === first.interviewId)).toHaveLength(1);
  });

  it("Context Pack 正文真实进入模型，回答只引用实际使用的 segment", async () => {
    await bindContextMaterial("run-f03-material");
    const quick=C.operations.startQuickDigitalInterview.out.parse(await (await fetch(`${base}/interviews/digital/quick`,{method:"POST",headers:auth,body:startBody("context-start")})).json());
    const response=await fetch(`${base}/interviews/digital/quick/${quick.interviewId}/messages`,{method:"POST",headers:auth,body:JSON.stringify({interviewId:quick.interviewId,text:"谁否决？",expectedVersion:quick.version})});
    expect(response.status).toBe(201);
    const saved=C.operations.appendQuickDigitalInterviewMessage.out.parse(await response.json());
    expect(providerMessages.find(message=>message.role==="system")?.content).toContain("材料事实：财务与技术共同掌握采购否决权。");
    expect(saved.messages.at(-1)?.sourcePointers).toEqual(["context-pack:run-f03-material#segment:seg-f03-material@artifact-version-f03"]);
  });

  it("模型运行期间撤销 Context Pack 权限时拒绝落库", async () => {
    await bindContextMaterial("run-f03-revoke");
    const quick=C.operations.startQuickDigitalInterview.out.parse(await (await fetch(`${base}/interviews/digital/quick`,{method:"POST",headers:auth,body:startBody("revoke-start")})).json());
    providerHook=()=>asApp(ORG,c=>c.query(`UPDATE context_packs SET recorded=jsonb_set(recorded,'{query,principalId}',to_jsonb('revoked-user'::text)) WHERE org_id=$1 AND run_id=$2`,[ORG,"run-f03-revoke"])).then(()=>undefined);
    const response=await fetch(`${base}/interviews/digital/quick/${quick.interviewId}/messages`,{method:"POST",headers:auth,body:JSON.stringify({interviewId:quick.interviewId,text:"不要保存",expectedVersion:quick.version})});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({reasonCode:"PERMISSION_REVOKED_MIDWAY"});
    providerHook=null;
    const restored=C.operations.getQuickDigitalInterview.out.parse(await (await fetch(`${base}/interviews/digital/quick/${quick.interviewId}`,{headers:auth})).json());
    expect(restored.messages).toEqual([]);
  });

  it("转批量保留问答和来源指针，无权与不存在使用同一 404", async () => {
    const quick = C.operations.startQuickDigitalInterview.out.parse(await (await fetch(`${base}/interviews/digital/quick`, { method: "POST", headers: auth, body: startBody("start-convert") })).json());
    const withMessage = C.operations.appendQuickDigitalInterviewMessage.out.parse(await (await fetch(`${base}/interviews/digital/quick/${quick.interviewId}/messages`, { method: "POST", headers: auth, body: JSON.stringify({ interviewId: quick.interviewId, text: "交付风险？", expectedVersion: quick.version }) })).json());
    const convertBody = JSON.stringify({ interviewId: quick.interviewId, expectedVersion: withMessage.version, name: "德国采购批量研究", tags: ["采购"], topic: "验证采购决策链" });
    const [converted, replay] = await Promise.all([1,2].map(() => fetch(`${base}/interviews/digital/quick/${quick.interviewId}/convert`, { method: "POST", headers: auth, body: convertBody })));
    expect(converted!.status).toBe(201); expect(replay!.status).toBe(201);
    const first=C.operations.convertQuickInterviewToBatch.out.parse(await converted!.json());
    expect(first).toMatchObject({ sourceQuickInterviewId: quick.interviewId, name: "德国采购批量研究" });
    expect(first.sourceMaterials).toEqual([
      { sourceMessageId: withMessage.messages[0]!.messageId, role: "user", text: "交付风险？", sourcePointers: [] },
      { sourceMessageId: withMessage.messages[1]!.messageId, role: "assistant", text: "专家回答：交付风险？", sourcePointers: ["agent-version:av-f03"] },
    ]);
    const replayBody=C.operations.convertQuickInterviewToBatch.out.parse(await replay!.json());
    expect(replayBody).toEqual(first);
    const otherAuth = { ...auth, "x-kernel-test-principal": `other:${OTHER}` };
    const denied = await fetch(`${base}/interviews/digital/quick/${quick.interviewId}`, { headers: otherAuth });
    const missing = await fetch(`${base}/interviews/digital/quick/missing`, { headers: auth });
    const deniedBody = await denied.text();
    const missingBody = await missing.text();
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(maskTrace(deniedBody)).toBe(maskTrace(missingBody));
    expect(deniedBody).not.toContain("reasonCode"); expect(missingBody).not.toContain("reasonCode");

    for (const suffix of ["messages", "convert"]) {
      const body = suffix === "messages"
        ? { interviewId: quick.interviewId, text: "probe", expectedVersion: withMessage.version }
        : { interviewId: quick.interviewId, expectedVersion: withMessage.version, name: "x", tags: ["x"], topic: "x" };
      const deniedWrite = await fetch(`${base}/interviews/digital/quick/${quick.interviewId}/${suffix}`, { method: "POST", headers: otherAuth, body: JSON.stringify(body) });
      const missingWrite = await fetch(`${base}/interviews/digital/quick/missing/${suffix}`, { method: "POST", headers: auth, body: JSON.stringify({ ...body, interviewId: "missing" }) });
      expect(deniedWrite.status).toBe(404); expect(missingWrite.status).toBe(404);
      expect(maskTrace(await deniedWrite.text())).toBe(maskTrace(await missingWrite.text()));
    }
  });
});
