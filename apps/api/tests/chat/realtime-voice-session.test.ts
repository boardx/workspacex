/**
 * Chat 语音模式用例（`application/chat/realtime-voice-session.ts`）：线程判权、已发布角色解析
 * （fail closed）、服务端人设/音色推导、转写落库形状。个人线程路径，假仓储，无数据库。
 */
import { stripSimulatedVoiceMarker } from "../../scripts/loopback-omni-realtime";
import { describe, expect, it } from "vitest";
import {
  appendRealtimeVoiceTurn,
  openRealtimeVoiceSession,
  RealtimeVoiceAgentUnavailableError,
  RealtimeVoiceThreadUnavailableError,
  REALTIME_VOICE_GENERIC_AUTHOR_ID,
  type RealtimeVoiceSessionDeps,
} from "../../src/application/chat/realtime-voice-session";
import type { AgentDirectoryRow } from "../../src/application/agent/list-agent-directory";
import type { ThreadFacts } from "../../src/domain/chat/thread-visibility";
import { buildRealtimeVoiceInstructions, resolveRealtimeVoice } from "../../src/domain/chat/realtime-voice-persona";

const ORG = "org-1" as never;

function thread(over: Partial<ThreadFacts> = {}): ThreadFacts {
  return { threadId: "t-1", projectId: null, groupId: null, visibilityScope: "private" as never, createdBy: "u-1", archived: false, ...over };
}

const ROW: AgentDirectoryRow = {
  agentId: "agent-dh-01", versionId: "v1", instructions: "PUBLISHED-BACKGROUND 产品研发经历与需求分析方法", name: "研究员小周", roleLabel: "行业研究与竞品分析",
  avatar: { kind: "illustration", key: "dh-01-researcher" as never, alt: "小周" }, roleCategory: "research",
  tags: ["竞品", "市场"], catalogSource: "official" as never, workflowAllowlist: [], toolPolicyLength: 0,
} as unknown as AgentDirectoryRow;

function deps(opts: { facts?: ThreadFacts | null; row?: AgentDirectoryRow | null; voiceMap?: Record<string, string>; member?: boolean } = {}) {
  const inserted: unknown[] = [];
  let n = 0;
  const d: RealtimeVoiceSessionDeps = {
    repo: {
      findOrgMembership: async () => (opts.member === false ? null : { orgRole: "member", teamId: null }),
      findBindings: async () => new Map(),
    } as never,
    ids: { next: () => `d-${++n}` } as never,
    chat: {
      findThreadFacts: async () => (opts.facts === undefined ? thread() : opts.facts),
      insertVoiceTranscriptMessage: async (_org: unknown, input: unknown) => { inserted.push(input); },
    } as never,
    directory: {
      listVisible: async () => [],
      findVisible: async (_org, agentId) => (opts.row === undefined ? (agentId === ROW.agentId ? ROW : null) : opts.row),
    },
    voiceMap: opts.voiceMap ?? {},
    defaultVoice: "Maia",
  };
  return { d, inserted };
}

describe("openRealtimeVoiceSession", () => {
  it("fails closed when the visible published role has no instructions", async () => {
    for (const instructions of [undefined, null, "   "]) {
      const { d } = deps({ row: { ...ROW, instructions } });
      await expect(openRealtimeVoiceSession(d, {
        orgId: ORG, userId: "u-1", threadId: "t-1", agentId: ROW.agentId,
      })).rejects.toBeInstanceOf(RealtimeVoiceAgentUnavailableError);
    }
  });

  it("preserves published instructions and version, then appends voice-only boundaries", async () => {
    const { d } = deps();
    const session = await openRealtimeVoiceSession(d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: "agent-dh-01" });
    expect(session.agentVersionId).toBe("v1");
    expect(session.instructions).toContain("PUBLISHED-BACKGROUND 产品研发经历与需求分析方法");
    expect(session.role.name).toBe("研究员小周");
    expect(session.instructions).toContain("研究员小周");
    expect(session.instructions).toContain("行业研究与竞品分析");
    expect(session.instructions).toContain("竞品、市场");
    expect(session.instructions).toContain("切换到文字对话");
    expect(session.voice).toBe("Maia");
  });

  it("picks voice from the server-side map by agentId > avatar key > roleCategory", async () => {
    expect((await openRealtimeVoiceSession(deps({ voiceMap: { research: "Cherry" } }).d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: "agent-dh-01" })).voice).toBe("Cherry");
    expect((await openRealtimeVoiceSession(deps({ voiceMap: { research: "Cherry", "dh-01-researcher": "Ethan" } }).d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: "agent-dh-01" })).voice).toBe("Ethan");
    expect((await openRealtimeVoiceSession(deps({ voiceMap: { "dh-01-researcher": "Ethan", "agent-dh-01": "Serena" } }).d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: "agent-dh-01" })).voice).toBe("Serena");
  });

  it("uses the generic assistant (通用助手) when no agent is selected", async () => {
    const session = await openRealtimeVoiceSession(deps().d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: null });
    expect(session.role).toMatchObject({ agentId: null, name: "通用助手" });
    expect(session.voice).toBe("Maia");
  });

  it("fails closed when the agent is not published/visible in the caller's org", async () => {
    await expect(openRealtimeVoiceSession(deps({ row: null }).d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: "agent-other-org" }))
      .rejects.toBeInstanceOf(RealtimeVoiceAgentUnavailableError);
  });

  it.each([
    ["missing thread", { facts: null }],
    ["someone else's personal thread", { facts: thread({ createdBy: "u-2" }) }],
    ["archived thread", { facts: thread({ archived: true }) }],
    ["caller not an org member", { member: false }],
  ])("fails closed on %s", async (_label, opts) => {
    await expect(openRealtimeVoiceSession(deps(opts as never).d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: null }))
      .rejects.toBeInstanceOf(RealtimeVoiceThreadUnavailableError);
  });
});

describe("appendRealtimeVoiceTurn", () => {
  it("writes user turns as human messages and assistant turns as agent messages; skips blanks", async () => {
    const { d, inserted } = deps();
    const withAgent = await openRealtimeVoiceSession(d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: "agent-dh-01" });
    const generic = await openRealtimeVoiceSession(d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: null });
    expect(await appendRealtimeVoiceTurn(d, withAgent, { role: "user", text: " 你好 " })).toMatch(/.+/);
    await appendRealtimeVoiceTurn(d, withAgent, { role: "assistant", text: "你好呀" });
    await appendRealtimeVoiceTurn(d, generic, { role: "assistant", text: "在的" });
    expect(await appendRealtimeVoiceTurn(d, generic, { role: "user", text: "  " })).toBeNull();
    expect(inserted).toEqual([
      expect.objectContaining({ threadId: "t-1", authorKind: "human", authorId: "u-1", agentId: null, body: "你好" }),
      expect.objectContaining({ authorKind: "agent", authorId: "agent-dh-01", agentId: "agent-dh-01", body: "你好呀" }),
      expect.objectContaining({ authorKind: "agent", authorId: REALTIME_VOICE_GENERIC_AUTHOR_ID, agentId: null, body: "在的" }),
    ]);
  });
});

describe("appendRealtimeVoiceTurn auto-title", () => {
  it("titles a default-named thread from the first user turn, never from assistant turns, never over a user title", async () => {
    const { d } = deps();
    const titled: Array<[string, number]> = [];
    let state = { title: "新对话", source: "default", stage: 0, humanMessageCount: 1 };
    Object.assign(d.chat, {
      readThreadTitleState: async () => state,
      autoTitleThread: async (_o: unknown, _t: string, title: string, stage: number) => { titled.push([title, stage]); return true; },
    });
    const s = await openRealtimeVoiceSession(d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: null });
    await appendRealtimeVoiceTurn(d, s, { role: "assistant", text: "你好，请讲" });
    expect(titled).toEqual([]);
    await appendRealtimeVoiceTurn(d, s, { role: "user", text: "（模拟语音）你好，我想了解一下产品方案" });
    expect(titled).toHaveLength(1);
    expect(titled[0]![0]).toMatch(/产品方案/);
    expect(titled[0]![1]).toBe(1);
    state = { ...state, source: "user" };
    await appendRealtimeVoiceTurn(d, s, { role: "user", text: "再说一个很具体的新话题关于预算" });
    expect(titled).toHaveLength(1);
  });
});

describe("appendRealtimeVoiceTurn fixture title marker", () => {
  it("strips the simulated marker from the title only when titleText is injected; body is stored verbatim", async () => {
    const { d } = deps();
    const titled: string[] = [];
    Object.assign(d.chat, {
      readThreadTitleState: async () => ({ title: "新对话", source: "default", stage: 0, humanMessageCount: 1 }),
      autoTitleThread: async (_o: unknown, _t: string, title: string) => { titled.push(title); return true; },
    });
    const s = await openRealtimeVoiceSession(d, { orgId: ORG, userId: "u-1", threadId: "t-1", agentId: null });
    const text = "（模拟语音）你好，我想了解一下产品方案";
    await appendRealtimeVoiceTurn(d, s, { role: "user", text });
    await appendRealtimeVoiceTurn({ ...d, titleText: stripSimulatedVoiceMarker }, s, { role: "user", text });
    expect(titled[0]).toContain("模拟语音");
    expect(titled[1]).not.toContain("模拟语音");
    expect(titled[1]).toMatch(/^你好/);
    expect(stripSimulatedVoiceMarker("普通（模拟语音）")).toBe("普通（模拟语音）");
  });
});

describe("realtime voice persona (domain)", () => {
  it("falls back to the default voice and omits empty duty/tags lines", () => {
    const role = { agentId: null, name: "通用助手", duty: null, tags: [], avatarKey: null, roleCategory: null };
    expect(resolveRealtimeVoice(role, {}, "Maia")).toBe("Maia");
    const text = buildRealtimeVoiceInstructions(role);
    expect(text).not.toContain("职责");
    expect(text).not.toContain("擅长");
  });
});
