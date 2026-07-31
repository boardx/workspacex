/**
 * R3 步骤 3：把已挂载的 skill 从当前线程摘掉（F65）。
 *
 * 依据：契约 `unmountSkillFromThread`；domain.md I-19；UC-3.3 R3 步骤 3 / AC3。
 *
 * ⚠ **I-19 不回溯是结构性的**：本用例的依赖清单里**只有** `ThreadMountStorePort`，
 *   没有任何指向「历史消息 / 消息角标」的端口——`MessageSkillTag`（见
 *   `domain/skill/thread-mount.ts`）这个类型在本文件里连名字都没出现。
 *   要让摘除顺带改掉某条历史消息的角标，得先给这个用例加一个新端口，
 *   那是一次会被 review 看见的改动，而不是一行漏改的判断。
 *
 * ⚠ 摘除是**打时间戳**（`removedAt`），不是删行：`unmountOne()` 保留了这条挂载
 *   曾经存在过、以及它何时失效的事实，供复盘（AC1）与「查看当时挂了什么」使用。
 */
import { unmountOne, type ThreadSkillMount } from "../../domain/skill/thread-mount";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { ThreadMountStorePort } from "./ports";

export interface UnmountSkillFromThreadInput {
  readonly threadId: string;
  readonly mountId: string;
  readonly removedAt: string;
}

export type UnmountSkillFromThreadResult =
  | { readonly ok: true; readonly mountId: string; readonly removedAt: string }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface UnmountSkillFromThreadDeps {
  readonly mounts: ThreadMountStorePort;
}

export async function unmountSkillFromThread(
  input: UnmountSkillFromThreadInput,
  deps: UnmountSkillFromThreadDeps,
): Promise<UnmountSkillFromThreadResult> {
  const current = await deps.mounts.load(input.threadId);
  const found = current.find((m) => m.mountId === input.mountId);
  if (found === undefined) {
    return { ok: false, code: "SKILL_NOT_FOUND", reason: "该临时挂载不存在或已不在此线程" };
  }

  const next: readonly ThreadSkillMount[] = unmountOne(current, input.mountId, input.removedAt);
  await deps.mounts.save(input.threadId, next);
  return { ok: true, mountId: input.mountId, removedAt: input.removedAt };
}
