/**
 * Chat 语音模式（实时数字人，ADR-121）的两个用例：
 *
 * 1. `openRealtimeVoiceSession` —— 会话开始前的判权与人设解析。线程必须对调用者可见且可写
 *    （非观察者、未归档）；所选 Agent 必须是本组织已发布、可见的角色（`AgentDirectoryRepository.
 *    findVisible`，与 `/agent` 目录同一条 fail-closed 规则）。任一不满足即抛错，网关拒绝开会话。
 *    指令与音色都在服务端推导（`domain/chat/realtime-voice-persona.ts`），客户端无权指定。
 * 2. `appendRealtimeVoiceTurn` —— 一轮说完后把转写落成普通 Chat 消息，挂断后线程里能看到整段对话。
 */
import { randomUUID } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import {
  buildRealtimeVoiceInstructions,
  genericRealtimeVoiceRole,
  resolveRealtimeVoice,
  type RealtimeVoiceMap,
  type RealtimeVoiceRole,
} from "../../domain/chat/realtime-voice-persona";
import type { AgentDirectoryRepository } from "../agent/list-agent-directory";
import { deriveThreadTitle } from "../../domain/chat/thread-title";
import { isLowInformation, shouldReplaceTitle } from "../../domain/chat/thread-title-algorithm";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";

export class RealtimeVoiceThreadUnavailableError extends Error {
  constructor() { super("realtime_voice_thread_unavailable"); this.name = "RealtimeVoiceThreadUnavailableError"; }
}
export class RealtimeVoiceAgentUnavailableError extends Error {
  constructor() { super("realtime_voice_agent_unavailable"); this.name = "RealtimeVoiceAgentUnavailableError"; }
}

/** 通用助手（未选数字人）的 assistant 消息 `author_id`。 */
export const REALTIME_VOICE_GENERIC_AUTHOR_ID = "realtime-voice-assistant";

export interface RealtimeVoiceSessionDeps extends ResolveVisibilityDeps {
  readonly directory: AgentDirectoryRepository;
  readonly voiceMap: RealtimeVoiceMap;
  readonly defaultVoice: string;
}

export interface RealtimeVoiceSession {
  readonly orgId: OrgId;
  readonly userId: string;
  readonly threadId: string;
  readonly role: RealtimeVoiceRole;
  readonly instructions: string;
  readonly voice: string;
}

export async function openRealtimeVoiceSession(
  deps: RealtimeVoiceSessionDeps,
  input: { readonly orgId: OrgId; readonly userId: string; readonly threadId: string; readonly agentId: string | null },
): Promise<RealtimeVoiceSession> {
  const facts = await deps.chat.findThreadFacts(input.orgId, input.threadId);
  if (facts === null) throw new RealtimeVoiceThreadUnavailableError();
  const visibility = await resolveVisibility(deps, {
    userId: input.userId, orgId: input.orgId, projectId: facts.projectId, threadId: input.threadId,
  });
  if (visibility.kind !== "allow") throw new RealtimeVoiceThreadUnavailableError();
  if (visibility.actor.projectRole === "observer" || visibility.thread.archived) throw new RealtimeVoiceThreadUnavailableError();

  let role: RealtimeVoiceRole = genericRealtimeVoiceRole();
  if (input.agentId !== null) {
    const row = await deps.directory.findVisible(input.orgId, input.agentId);
    if (row === null) throw new RealtimeVoiceAgentUnavailableError();
    role = {
      agentId: row.agentId,
      name: row.name.trim() || row.agentId,
      duty: row.roleLabel.trim() || null,
      tags: row.tags,
      avatarKey: row.avatar?.key ?? null,
      roleCategory: row.roleCategory,
    };
  }
  return {
    orgId: input.orgId,
    userId: input.userId,
    threadId: input.threadId,
    role,
    instructions: buildRealtimeVoiceInstructions(role),
    voice: resolveRealtimeVoice(role, deps.voiceMap, deps.defaultVoice),
  };
}

/** 返回落库消息 id；空白转写不落库，返回 null。 */
export async function appendRealtimeVoiceTurn(
  deps: Pick<ResolveVisibilityDeps, "chat">,
  session: RealtimeVoiceSession,
  turn: { readonly role: "user" | "assistant"; readonly text: string },
): Promise<string | null> {
  const body = turn.text.trim();
  if (body.length === 0) return null;
  const id = randomUUID();
  await deps.chat.insertVoiceTranscriptMessage(session.orgId, {
    id,
    threadId: session.threadId,
    authorKind: turn.role === "user" ? "human" : "agent",
    authorId: turn.role === "user" ? session.userId : session.role.agentId ?? REALTIME_VOICE_GENERIC_AUTHOR_ID,
    agentId: turn.role === "user" ? null : session.role.agentId,
    body,
  });
  if (turn.role === "user") await autoTitleFromVoiceTurn(deps, session, body);
  return id;
}

/**
 * 语音线程的第一句用户转写就给线程起名（与文字路径同一套 `deriveThreadTitle` /
 * `shouldReplaceTitle`，不另写规则）；只在还是默认名时落第 1 档，失败不影响落库。
 */
async function autoTitleFromVoiceTurn(
  deps: Pick<ResolveVisibilityDeps, "chat">,
  session: RealtimeVoiceSession,
  body: string,
): Promise<void> {
  try {
    if (isLowInformation(body)) return;
    const state = await deps.chat.readThreadTitleState(session.orgId, session.threadId);
    if (state === null || state.source !== "default") return;
    const title = deriveThreadTitle(body);
    if (!shouldReplaceTitle(state.title, title, state.source)) return;
    await deps.chat.autoTitleThread(session.orgId, session.threadId, title as string, 1);
  } catch {
    // 标题是装饰：转写已落库，起名失败只是标题停在「新对话」。
  }
}

/** 网关只依赖这个端口（便于用假实现测握手/落库路径）；`main.ts` 用上面两个用例装配。 */
export interface RealtimeVoiceSessionPort {
  open(input: { readonly orgId: OrgId; readonly userId: string; readonly threadId: string; readonly agentId: string | null }): Promise<RealtimeVoiceSession>;
  append(session: RealtimeVoiceSession, turn: { readonly role: "user" | "assistant"; readonly text: string }): Promise<string | null>;
}

export function realtimeVoiceSessionService(deps: RealtimeVoiceSessionDeps): RealtimeVoiceSessionPort {
  return {
    open: (input) => openRealtimeVoiceSession(deps, input),
    append: (session, turn) => appendRealtimeVoiceTurn(deps, session, turn),
  };
}
