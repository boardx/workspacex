/**
 * `startPresetInstance` —— 开始一个预设实例（F115 · uc-8-4 UC-25）。
 *
 * ⚠ 打开即带好开场提示、agent 与 skill，**无需任何配置动作**——这里体现为：
 *   实例的线程直接继承预设当前版本的 `openingPrompt` / `agents` / `skills`，
 *   调用方不需要（也没有输入位）再传一遍这些字段（契约 `startPresetInstance.in`
 *   只有 `presetId` 一个字段）。
 *
 * ## 「预设≠实例可见性」在这里落地成两件独立的事（I-39）
 *
 * 1. 预设本身的可见性——「谁能看到并开始这个预设」——由 `isActorDispatchTarget`
 *    判定，只问「这个人在不在下发对象里」。
 * 2. 实例（生成的那条对话线程）的可见性——完全是另一条判定路径：
 *    `createPresetInstance` 建的是一行**普通 `chat_threads`**，
 *    `visibilityScope: "private"`，读它走的是 F108 既有的 `resolveVisibility`/
 *    `decideThreadRead`（`private` 分支：`actor.userId === thread.createdBy`）。
 *    本文件**不**为「谁能看这个实例」另写一个判断——那正是本 feature 最核心的
 *    不变量要求的：改一个不能牵动另一个，所以这里干脆是两个完全不相交的代码路径。
 *
 * ## 幂等（I-38 的另一半）
 *
 * 同一人重复点「开始」返回**同一个** `instanceId`/`threadId`，不产生第二个实例——
 * 否则 `getPresetUsage` 的计数会被同一个人的重复点击刷高。这里先查
 * `findInstanceForActor`，命中就直接返回；仓储层另有
 * `UNIQUE (preset_id, started_by)` 兜底并发场景（两次几乎同时的点击）。
 */
import type { OrgId } from "../../domain/org-id";
import type { NewThreadInput } from "./ports";
import type { ChatPresetRepository } from "./ports";
import type { IdFactory } from "../artifact/ports";

export class NotDispatchedToActorError extends Error {
  constructor() {
    super("not_dispatched_to_actor");
  }
}
export class PresetNotFoundError extends Error {
  constructor() {
    super("preset_not_found");
  }
}

export interface StartPresetInstanceDeps {
  readonly chatPresets: ChatPresetRepository;
  readonly threadIds: IdFactory;
}

export interface StartPresetInstanceInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly presetId: string;
}

export interface StartPresetInstanceResult {
  readonly threadId: string;
  readonly instanceId: string;
}

export async function startPresetInstance(
  deps: StartPresetInstanceDeps,
  input: StartPresetInstanceInput,
): Promise<StartPresetInstanceResult> {
  const preset = await deps.chatPresets.findPreset(input.orgId, input.presetId);
  if (preset === null) throw new PresetNotFoundError();

  const existing = await deps.chatPresets.findInstanceForActor(input.orgId, input.presetId, input.userId);
  if (existing !== null) return existing;

  const isTarget = await deps.chatPresets.isActorDispatchTarget(
    input.orgId,
    input.presetId,
    input.projectId,
    input.userId,
  );
  if (!isTarget) throw new NotDispatchedToActorError();

  const newThread: NewThreadInput = {
    orgId: input.orgId,
    threadId: deps.threadIds.next("thr"),
    projectId: preset.projectId,
    groupId: null,
    // 开场提示落在标题位——契约 `Thread`/`ThreadCard` 没有独立的「开场提示」字段，
    // 消息流的第一条消息才是 openingPrompt 真正的落点（uc-8-4 UC-25 出参只有
    // threadId/instanceId），标题使用它是为了让线程列表一眼看出这是哪个预设开的。
    title: preset.openingPrompt.slice(0, 200),
    // 各人开始后生成的是**各自私有**的对话实例（uc-8-4 R7）——I-39 的可见性判定
    // 因此直接复用 F108 `private` 分支（仅创建者），不新起一套判断，见文件头。
    visibilityScope: "private",
    createdBy: input.userId,
  };

  return deps.chatPresets.createPresetInstance(input.orgId, input.presetId, input.userId, newThread);
}
