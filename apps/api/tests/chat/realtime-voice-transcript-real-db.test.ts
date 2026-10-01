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
  type RealtimeVoiceSessionDeps,
} from "../../src/application/chat/realtime-voice-session";
import { addChatThread } from "../support/chat-db";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "org-rt-voice";
const THREAD = "thread-rt-voice-personal";
let db: PgDatabase;
let deps: RealtimeVoiceSessionDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  for (const u of ["u-owner", "u-other"]) await addOrgMember(ORG, u, "consultant", fx.teams.energy!);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: null, visibilityScope: "private", createdBy: "u-owner" });
  db = new PgDatabase(appConfig());
  const chat = new PgChatRepository(db);
  deps = {
    repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory(), chat,
    directory: { listVisible: async () => [], findVisible: async () => null },
    voiceMap: {}, defaultVoice: "Maia",
  };
});

afterAll(async () => {
  await db.close();
});

describe("realtime voice transcripts (real DB)", () => {
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
