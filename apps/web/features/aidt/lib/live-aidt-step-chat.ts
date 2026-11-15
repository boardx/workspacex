import { createThread, getThread, listThreads } from "@/lib/live-chat";
import { skills } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "@/lib/api-client";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
import { listThreadMounts, mountSkills } from "@/lib/live-skill-mount";
import { AIDT_STEPS, type AidtStep } from "@/features/aidt/lib/project-aidt";

type Input = { orgId: string; userId: string; projectId: string; step: AidtStep; thread: string | null; sessionToken: string; signal?: AbortSignal; createLatest?: { expectedLatestVersionId: string; expectedPinnedVersionId: string } };
export class AidtStepChatChoiceError extends Error {
  constructor(public readonly choices: readonly { id: string; title: string }[]) { super("本组有多个本步对话，请共同选择要继续的一条。不会自动合并或删除。"); }
}
export type AidtStepChat = { threadId: string; skillName: string; versionId: string; latestVersionId?: string };
/** Explicit action: preserve the source thread and create/recover a separate empty latest-version conversation. */
export function createAidtStepChatWithLatest(input: Input & { thread: string; expectedLatestVersionId: string; expectedPinnedVersionId: string }): Promise<AidtStepChat> {
  return resolveAidtStepChat({ ...input, createLatest: { expectedLatestVersionId: input.expectedLatestVersionId, expectedPinnedVersionId: input.expectedPinnedVersionId } });
}
// Coalesce only identical authorization scopes. A cancelled consumer must not
// cancel another active host; after the last cancellation no later write starts.
type Pending = { task: Promise<AidtStepChat>; scope: { consumers: Set<AbortSignal>; unscoped: boolean } };
const pending = new Map<string, Pending>();
export function resolveAidtStepChat(input: Input): Promise<AidtStepChat> {
  if (!isAidtModuleEnabled()) return Promise.reject(new Error("教学模块未启用。"));
  if (input.signal?.aborted) return Promise.reject(new Error("AIDT_CONTEXT_CHANGED"));
  const key = JSON.stringify([input.orgId, input.userId, input.sessionToken, input.projectId, input.step.id, input.thread, input.createLatest]);
  const existing = pending.get(key);
  if (existing) {
    if (input.signal) existing.scope.consumers.add(input.signal); else existing.scope.unscoped = true;
    return existing.task;
  }
  const consumers = new Set<AbortSignal>(input.signal ? [input.signal] : []);
  const scope = { consumers, unscoped: !input.signal };
  const assertCurrent = () => {
    if (!isAidtModuleEnabled() || (!scope.unscoped && !Array.from(consumers).some((signal) => !signal.aborted))) throw new Error("AIDT_CONTEXT_CHANGED");
  };
  const task = resolve(input, assertCurrent).finally(() => { if (pending.get(key)?.task === task) pending.delete(key); });
  pending.set(key, { task, scope });
  return task;
}

async function resolve({ orgId, userId, projectId, step, thread, sessionToken, createLatest }: Input, assertCurrent: () => void): Promise<AidtStepChat> {
  assertCurrent();
  // Same authorized library operation, with this host's captured bearer rather
  // than the mutable globally stored session used by the generic library UI.
  const { items: catalog } = await apiRequest<z.infer<typeof skills.operations.listSkills.out>>(skills.operations.listSkills.path, { method: "GET", query: { orgId, entry: "library" }, sessionToken });
  assertCurrent();
  const skill = catalog.find((entry) => entry.platformStableName === step.skill && entry.status === "已启用" && entry.currentVersionId);
  if (!skill) throw new Error("本步骤的 AIDT Skill 尚未安装或启用，无法开始教学对话。");
  if (createLatest && (!thread || createLatest.expectedLatestVersionId !== skill.currentVersionId)) throw new Error("目录中的教学版本已变化，请重新读取后选择。");
  const aidtSkillIds = new Set(catalog.filter((entry) => AIDT_STEPS.some((it) => it.skill === entry.platformStableName)).map((entry) => entry.skillId));
  const read = async (id: string) => {
    assertCurrent();
    const detail = await getThread(id, projectId, sessionToken);
    assertCurrent();
    if (detail.thread.projectId !== projectId) throw new Error("该对话不属于当前可编辑项目，或你没有发送权限。");
    const mounts = await listThreadMounts(id, projectId, sessionToken);
    assertCurrent();
    const active = mounts.temporary.filter((entry) => entry.removedAt === null);
    const match = active.find((entry) => entry.skillId === skill.skillId);
    const wrongStep = active.some((entry) => aidtSkillIds.has(entry.skillId) && entry.skillId !== skill.skillId);
    return { detail, mounts, match, wrongStep };
  };
  const result = (id: string, versionId: string) => ({ threadId: id, skillName: skill.name, versionId, latestVersionId: skill.currentVersionId! });
  if (thread) {
    const state = await read(thread);
    assertCurrent();
    if (state.detail.thread.visibilityScope !== "plenary") throw new Error("这个对话是个人范围，不能作为小组共同对话。请返回本步对话。");
    if (state.detail.thread.archived || !state.detail.capabilities.includes("composer.send")) throw new Error("当前对话只读，无法开始教学对话。");
    if (!state.match || state.wrongStep) throw new Error("这个对话未绑定本步骤的 Skill。请返回本步对话，不要跨步骤复用会话。");
    if (!createLatest) return result(thread, state.match.versionId);
    if (state.match.versionId !== createLatest.expectedPinnedVersionId || state.match.versionId === skill.currentVersionId) throw new Error("原对话的教学挂载已变化，请重新读取后选择。");
  }
  const title = `[AIDT ${step.id}] ${step.title}${createLatest ? " · 新版教学" : ""}`;
  const listed = await listThreads(projectId, {}, sessionToken);
  assertCurrent();
  const cards = listed.groups.flatMap((group) => group.cards);
  const matches: { id: string; title: string; versionId: string }[] = [];
  let recovery: { id: string; state: Awaited<ReturnType<typeof read>> } | undefined;
  // The persisted mount identifies a step even after the native thread is renamed.
  // Bounded batches avoid flooding the API on projects with many conversations.
  for (let offset = 0; offset < cards.length; offset += 8) {
    const batch = cards.slice(offset, offset + 8);
    const states = await Promise.all(batch.map(async (card) => ({ card, state: await read(card.id) })));
    assertCurrent();
    for (const { card, state } of states) {
      if (state.detail.thread.archived || state.detail.thread.visibilityScope !== "plenary" || !state.detail.capabilities.includes("composer.send")) continue;
      if (createLatest && card.title === title && state.detail.thread.createdBy === userId && state.detail.messages.length === 0 && state.match?.versionId === createLatest.expectedLatestVersionId && !state.wrongStep) return result(card.id, state.match.versionId);
      if (!createLatest && state.match && !state.wrongStep) matches.push({ id: card.id, title: card.title, versionId: state.match.versionId });
      if (card.title === title && state.detail.thread.createdBy === userId && state.detail.messages.length === 0 && state.mounts.temporary.every((entry) => entry.removedAt !== null) && !state.match && !state.wrongStep) recovery ??= { id: card.id, state };
    }
  }
  if (matches.length > 1) throw new AidtStepChatChoiceError(matches);
  if (matches.length === 1) return result(matches[0]!.id, matches[0]!.versionId);
  assertCurrent();
  const id = recovery?.id ?? (await createThread({ projectId, title, groupId: null, visibilityScope: "plenary" }, sessionToken)).threadId;
  assertCurrent();
  const before = recovery?.state ?? await read(id);
  // Use the authoritative optimistic version; a conflict is surfaced, never overwritten.
  assertCurrent();
  await mountSkills(id, projectId, { skillIds: [skill.skillId], expectedVersion: before.mounts.version }, sessionToken);
  assertCurrent();
  const saved = await read(id);
  assertCurrent();
  if (!saved.match || saved.wrongStep || (createLatest && saved.match.versionId !== createLatest.expectedLatestVersionId)) throw new Error("步骤 Skill 挂载未能确认。对话已保留，请重试。");
  return result(id, saved.match.versionId);
}
