/**
 * 读回一条会话当前挂着的 skill（契约 `listThreadSkillMounts`）。
 *
 * ## 这个用例存在的理由，就是本束原本有写没有读
 *
 * `mount-skill-to-thread.ts` 挂得上、`unmount-skill-from-thread.ts` 摘得掉，
 * 但在此之前**没有任何 application 用例能回答「现在挂着什么」**。
 * 于是「挂上去了」这件事在端到端层面不可证——刷新一次就无从断言。
 *
 * ⚠ **不是 `resolve-mounted-skills`**。那个入参是 `{projectId, agendaSegmentId}`、
 *   走 `orchestrations.load`，是 F64 项目编排的自动挂载：**键空间与端口都不同**。
 *   把它当作本束的读侧是 #509 里记过的一次误判，这里逐字写下来防止再犯。
 *
 * ## 为什么这么薄，以及为什么薄是对的
 *
 * 它只做两件事：向 `ThreadMountStorePort` 要那条线程的全部挂载记录，
 * 再交给 domain 的 `activeMounts` 过滤。**没有第三件。**
 *
 * · 过滤规则**不在这里重写**。摘除是打 `removedAt` 时间戳而不是删行（I-19/V3），
 *   「哪些算活动的」是一条 domain 规则，`activeMounts` 是它的唯一落点。
 *   在这里写一遍 `filter(m => m.removedAt === null)` 就等于造第二份事实源——
 *   哪天摘除语义变了（比如加一个「暂停」态），两处会各自漂。
 * · 依赖清单里**只有一个只读端口**。这本身就是「读用例不会写」的结构性证据：
 *   要让它写点什么，得先给它加一个依赖，那是一次会被 review 看见的改动。
 */
import { activeMounts, type ThreadSkillMount } from "../../domain/skill/thread-mount";
import type { ThreadMountStorePort } from "./ports";

export interface ListThreadSkillMountsInput {
  readonly threadId: string;
}

export interface ListThreadSkillMountsDeps {
  readonly mounts: ThreadMountStorePort;
}

export interface ListThreadSkillMountsResult {
  readonly mounts: readonly ThreadSkillMount[];
}

export async function listThreadSkillMounts(
  input: ListThreadSkillMountsInput,
  deps: ListThreadSkillMountsDeps,
): Promise<ListThreadSkillMountsResult> {
  const stored = await deps.mounts.load(input.threadId);
  return { mounts: activeMounts(stored) };
}
