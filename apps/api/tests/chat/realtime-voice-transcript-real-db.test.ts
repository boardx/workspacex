import { createHash, randomUUID } from "node:crypto";
import { PgAgentDirectoryRepository } from "../../src/infrastructure/agent/pg-agent-directory-repository";
import { insertAgentVersionFromDraft } from "../../src/infrastructure/agent/agent-version-insert";
/**
 * Chat 语音模式转写落库——真库验证（`PgChatRepository.insertVoiceTranscriptMessage` + 真实判权）。
 * 个人线程：创建者能开会话、两轮转写落成普通消息（human / agent）且能被正常读回；非创建者 fail closed。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import {
  appendRealtimeVoiceTurn,
  openRealtimeVoiceSession,
  RealtimeVoiceThreadUnavailableError,
  RealtimeVoiceAgentUnavailableError,
  type RealtimeVoiceSessionDeps,
} from "../../src/application/chat/realtime-voice-session";
import { addChatThread } from "../support/chat-db";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-rt-voice";
const FOREIGN_ORG = "org-rt-voice-foreign";
const THREAD = "thread-rt-voice-personal";
let db: PgDatabase;
let deps: RealtimeVoiceSessionDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG, FOREIGN_ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  for (const u of ["u-owner", "u-other"]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  const foreign = await seedOrg({ orgId: FOREIGN_ORG, projectId: `${FOREIGN_ORG}-p` });
  await addOrgMember(FOREIGN_ORG, "u-owner", "consultant", foreign.teams.energy!);
  db = new PgDatabase(appConfig());
  const chat = new PgChatRepository(db);
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat,
    directory: new PgAgentDirectoryRepository(db),
    voiceMap: {}, defaultVoice: "Maia",
  };
});

afterAll(async () => {
  await resetOrgs(ORG, FOREIGN_ORG);
  await db.close();
});

async function publishedFixture(orgId = ORG, publish = true): Promise<{agentId:string;versionId:string;instructions:string}> {
  const agentId = `rt-voice-agent-${randomUUID()}`;
  const versionId = `rt-voice-version-${randomUUID()}`;
  const instructions = `你是产品经理。先明确用户问题、证据和验收标准。固定版本：${versionId}`;
  const at = new Date().toISOString();
  await db.withTenant(toOrgId(orgId), async (session) => {
    await session.query("INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at,role_label,instructions) VALUES ($1,$2,$3,$5,'enabled','u-owner',$4,$4,'产品经理','草稿背景：佛学冥想指导')", [agentId,orgId,agentId,at,`产品经理-${agentId}`]);
    await insertAgentVersionFromDraft(session, {versionId,orgId,agentId,semanticLabel:"1.0.0",instructionDigest:createHash("sha256").update(instructions).digest("hex"),instructions,skillVersionIds:[],modelProvider:"dashscope",modelId:"qwen-plus",toolPolicy:[],creatorId:"u-owner",at});
    if (publish) await session.query("UPDATE agents SET published_version_id=$3 WHERE id=$1 AND org_id=$2", [agentId,orgId,versionId]);
    await session.query("INSERT INTO capability_listings (id,org_id,kind,name,scope,enabled,abbr,duty) VALUES ($1,$2,'agent',$3,'org-wide',true,'PM','产品经理')", [agentId,orgId,`产品经理-${agentId}`]);
  });
  return {agentId,versionId,instructions};
}

describe("realtime voice transcripts (real DB)", () => {
  it("reads the actual published instruction/version, excludes draft changes, and freezes the open session", async () => {
    const fixture = await publishedFixture();
    const session = await openRealtimeVoiceSession(deps, {orgId:toOrgId(ORG),userId:"u-owner",threadId:THREAD,agentId:fixture.agentId});
    expect(session.agentVersionId).toBe(fixture.versionId);
    expect(session.instructions).toContain(fixture.instructions);
    expect(session.instructions).not.toContain("佛学冥想");
    expect(session.instructions).toContain("语音模式下你不能调用工具");
    const newer = `rt-voice-version-${randomUUID()}`;
    const newerInstructions = `你是产品经理。新发布版本专门帮助定义实验指标。${newer}`;
    await db.withTenant(toOrgId(ORG), async (tenant) => {
      await insertAgentVersionFromDraft(tenant, {versionId:newer,orgId:ORG,agentId:fixture.agentId,semanticLabel:"1.1.0",instructionDigest:createHash("sha256").update(newerInstructions).digest("hex"),instructions:newerInstructions,skillVersionIds:[],modelProvider:"dashscope",modelId:"qwen-plus",toolPolicy:[],creatorId:"u-owner",at:new Date().toISOString()});
      await tenant.query("UPDATE agents SET published_version_id=$3,instructions='仍未发布的另一个草稿' WHERE id=$1 AND org_id=$2", [fixture.agentId,ORG,newer]);
    });
    const reopened = await openRealtimeVoiceSession(deps, {orgId:toOrgId(ORG),userId:"u-owner",threadId:THREAD,agentId:fixture.agentId});
    expect(reopened.agentVersionId).toBe(newer);
    expect(reopened.instructions).toContain(newerInstructions);
    expect(reopened.instructions).not.toContain("另一个草稿");
    expect(session.agentVersionId).toBe(fixture.versionId);
    expect(session.instructions).toContain(fixture.instructions);
    expect(session.instructions).not.toContain(newerInstructions);
  });

  it("rejects a listed draft with no published pointer and a real other-tenant published agent", async () => {
    const draft = await publishedFixture(ORG, false);
    expect(await deps.directory.findVisible(toOrgId(ORG), draft.agentId)).toBeNull();
    await expect(openRealtimeVoiceSession(deps, {orgId:toOrgId(ORG),userId:"u-owner",threadId:THREAD,agentId:draft.agentId})).rejects.toBeInstanceOf(RealtimeVoiceAgentUnavailableError);
    const foreign = await publishedFixture(FOREIGN_ORG);
    expect((await deps.directory.findVisible(toOrgId(FOREIGN_ORG), foreign.agentId))?.versionId).toBe(foreign.versionId);
    expect(await deps.directory.findVisible(toOrgId(ORG), foreign.agentId)).toBeNull();
    await expect(openRealtimeVoiceSession(deps, {orgId:toOrgId(ORG),userId:"u-owner",threadId:THREAD,agentId:foreign.agentId})).rejects.toBeInstanceOf(RealtimeVoiceAgentUnavailableError);
  });

  it("persists user + assistant turns as ordinary thread messages readable through SQL", async () => {
    const session = await openRealtimeVoiceSession(deps, { orgId: toOrgId(ORG), userId: "u-owner", threadId: THREAD, agentId: null });
    const userId = await appendRealtimeVoiceTurn(deps, session, { role: "user", text: "今天的安排是什么" });
    const assistantId = await appendRealtimeVoiceTurn(deps, session, { role: "assistant", text: "上午有两个会。" });
    const { rows } = await asApp(ORG, (c) => c.query<{ id: string; body: string; author_kind: string; author_id: string; agent_id: string | null }>(
      "SELECT id, body, author_kind, author_id, agent_id FROM chat_messages WHERE org_id = $1 AND thread_id = $2", [ORG, THREAD]));
    const byId = new Map(rows.map((m) => [m.id, { body: m.body, authorKind: m.author_kind, authorId: m.author_id, agentId: m.agent_id }]));
    expect(byId.get(userId!)).toMatchObject({ body: "今天的安排是什么", authorKind: "human", authorId: "u-owner", agentId: null });
    expect(byId.get(assistantId!)).toMatchObject({ body: "上午有两个会。", authorKind: "agent" });
  });

  it("fails closed for a member who is not the personal thread's creator", async () => {
    await expect(openRealtimeVoiceSession(deps, { orgId: toOrgId(ORG), userId: "u-other", threadId: THREAD, agentId: null }))
      .rejects.toBeInstanceOf(RealtimeVoiceThreadUnavailableError);
  });
});
