/**
 * 对话内临时加减 skill（F65）。
 *
 * 依据：契约 `ThreadSkillMount` / `mountSkillToThread` / `unmountSkillFromThread`；
 * `contracts/skills/domain.md` I-18（作用域）/ I-19（不回溯）；UC-3.3 R3 / R5 / R7。
 *
 * 最内层：不知道 HTTP、不知道 PostgreSQL。
 *
 * ## 三条不变量在这里各有一个落点
 *
 * · **I-18 只对当前线程生效**：`ThreadMountStorePort`（见 `ports.ts`）以 `threadId`
 *   为唯一的读写单位，且本文件的纯函数只接受/吐出「某一个线程」的挂载列表——
 *   没有任何函数接受两个 `threadId` 或一个「全组织」的挂载表。要让一次挂载
 *   影响别的线程，得先改这里的函数签名，那是一次会被 review 看见的改动。
 * · **I-19 摘除不回溯**：`unmount()` 只把 `removedAt` 打上时间戳，**不删行**——
 *   历史消息角标（`MessageSkillTag`）与挂载列表是两个互不相交的结构，
 *   `unmount()` 的签名里根本没有 `MessageSkillTag[]` 这个参数，拿不到的东西改不了。
 * · **来源可区分**：`ThreadSkillMount` 与 `SegmentBinding`（F63/F64，蓝本绑定）
 *   是两个字段集完全不同的类型，分别来自两个不同的端口
 *   （`ThreadMountStorePort` vs `ProjectOrchestrationStorePort`）——
 *   可区分是**结构性的**（来自哪个端口/集合），不是靠一个 `source: "temp"` 标签字段
 *   （同 `binding-slot.ts` 「刻意没有 label 字段」的落法）。
 */
import { skills } from "@repo/contracts";
import type { z } from "zod";
import type { DeliverRole } from "./binding-slot";

/** 从契约派生，不重写（ADR-020）——契约与本域在这个形状上没有分歧可登记。 */
export type ThreadSkillMount = z.infer<typeof skills.ThreadSkillMount>;

/* ─────────────────────── 谁能自行挂载（R5 / S3） ─────────────────────── */

/**
 * **前置：引导师，或组长且引导师已下放该权限**（契约 `mountSkillToThread` 注释 / domain D-h）。
 *
 * ⚠ `KNOWN_CONTRACT_GAPS.S3`（`packages/contracts/src/skills.ts`）逐字记着：
 *   「没有任何操作能产生这次下放，该前置条件目前恒不可满足」。
 *   ⇒ 在委托机制落地前，**组长与组员同样被拒**——这不是把组长降级，
 *   是如实反映「下放开关不存在」这件事，而不是悄悄放行一个没有实现的权限位。
 *   一旦委托机制签核落地，改的是这一个函数，而不是散在各处的角色判断。
 */
export function isSelfMountAllowed(role: DeliverRole): boolean {
  return role === "引导师";
}

/* ─────────────────────── 挂载列表：纯函数，不原地改 ─────────────────────── */

/** 挂上一条（R3 步骤 2）。⚠ 只接受/吐出**这一个线程**的列表——见文件头第 1 条。 */
export function mountOne(
  mounts: readonly ThreadSkillMount[],
  entry: {
    readonly mountId: string;
    readonly threadId: string;
    readonly skillId: string;
    readonly versionId: string;
    readonly mountedAt: string;
  },
): readonly ThreadSkillMount[] {
  return [...mounts, { ...entry, removedAt: null }];
}

/**
 * 摘掉一条（R3 步骤 3）。⚠ 打时间戳，**不删行**——I-19 的落点。
 * 找不到该 `mountId` 时原样返回，不抛异常（幂等）。
 */
export function unmountOne(
  mounts: readonly ThreadSkillMount[],
  mountId: string,
  removedAt: string,
): readonly ThreadSkillMount[] {
  return mounts.map((m) => (m.mountId === mountId ? { ...m, removedAt } : m));
}

/** 当前仍生效的挂载（未摘除的那些）。 */
export function activeMounts(mounts: readonly ThreadSkillMount[]): readonly ThreadSkillMount[] {
  return mounts.filter((m) => m.removedAt === null);
}

/* ─────────────────────── 历史消息角标：与挂载列表结构性不相交 ─────────────────────── */

/**
 * 一条历史消息上「当时用了哪个 skill」的角标（UC-3.3 R3 步骤 3 / AC3）。
 *
 * ⚠ 这是**独立的一份记录**，不是从 `ThreadSkillMount` 派生出来的视图——
 *   一旦某条消息生成时打上了角标，它此后不随挂载列表变化而改变
 *   （`unmountOne` 的签名里没有这个类型，结构上碰不到）。
 */
export interface MessageSkillTag {
  readonly messageId: string;
  readonly threadId: string;
  readonly skillId: string;
  readonly versionId: string;
}

/** AI 回答时打角标（R3 步骤 4）：注入了哪些挂载，就在消息上留哪些角标。 */
export function tagMessage(
  tags: readonly MessageSkillTag[],
  tag: MessageSkillTag,
): readonly MessageSkillTag[] {
  return [...tags, tag];
}
