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
import { createHash } from "node:crypto";
import { skills } from "@repo/contracts";
import type { z } from "zod";
import type { ProjectRole } from "../identity/roles";

/** 从契约派生，不重写（ADR-020）——契约与本域在这个形状上没有分歧可登记。 */
export type ThreadSkillMount = z.infer<typeof skills.ThreadSkillMount>;

/* ─────────────────────── 谁能自行挂载（R5，2026-08-21 人类裁决改写） ─────────────────────── */

/**
 * **判据：能写这条线程的人，就能往它上面挂 skill。**
 *
 * ## 依据：人类产品裁决 2026-08-21（逐字）
 *
 * > 「个人对话必须要可以使用公共的 skills」
 * > 「所有的人都可以用」
 *
 * 此前本函数是 `role === "引导师"`，配 `KNOWN_CONTRACT_GAPS.S3`「组长的下放开关
 * 尚未落地」。裁决把那条前置**整个取消**了：不再有「谁被下放了挂载权」这个问题，
 * 因而 S3 那个缺口也不再是缺口（它描述的开关不需要存在了）。
 *
 * ## 为什么判据从 `DeliverRole` 换成「线程 + 角色」
 *
 * `DeliverRole`（引导师/组长/组员）是**项目**角色。个人对话 `project_id IS NULL`
 * ⇒ 没有项目 ⇒ 没有 `DeliverRole` ⇒ 用一个项目角色去判个人对话，答案必然是「拒绝」，
 * 而那正是裁决要推翻的行为。所以判据的输入必须包含「这是不是个人线程」。
 *
 * ## 两条分支
 *
 * · **个人线程**（`threadIsPersonal`）：仅创建者。与 `decidePersonalThreadRead`
 *   （`domain/chat/thread-visibility.ts`）同一条 creator-only 规则——本函数**不重算**
 *   它，由调用方把已判好的 `threadReadAllowed` 传进来（见 `authorize-thread-mount.ts`）。
 * · **项目线程**：任何该项目成员，**除观察者**。观察者是「只读」，
 *   给只读角色一个写入口就等于取消了这个角色。这与发消息路径
 *   （`message-roundtrip.ts` 的 `MessageNoWriteRoleError`）是同一条「能不能写」判据。
 *
 * ⚠ `threadReadAllowed` 是必需输入而不是「调用方应该先查一下」的约定：
 *   把它做成参数，意味着**拿不到可见性判定就调不动这个函数**——
 *   忘记判权在这里是一个类型错误，不是一次静默放行。
 */
export function isThreadMountAllowed(input: {
  /** 这条线程是否为个人对话（`project_id IS NULL`）。 */
  readonly threadIsPersonal: boolean;
  /** 调用方已经过 `resolveVisibility` 得到的「这个人能不能读这条线程」。 */
  readonly threadReadAllowed: boolean;
  /** 项目线程里的项目角色；个人线程恒 `null`。 */
  readonly projectRole: ProjectRole | null;
}): boolean {
  // 读不到的线程一律不能写。两条分支共用这道门，所以没有「个人线程绕过可见性」的路径。
  if (!input.threadReadAllowed) return false;
  // 个人线程：可读即可写——creator-only 已经由上面那道门表达完了（个人分支的
  // `resolveVisibility` 只对创建者返回 allow），这里再判一次 `createdBy` 就是第二份副本。
  if (input.threadIsPersonal) return true;
  // 项目线程：成员即可，观察者除外。
  return input.projectRole !== null && input.projectRole !== "observer";
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

/**
 * 挂载列表的指纹 —— 契约 `mountSkillToThread.in.expectedVersion` 的取值（#467）。
 *
 * ⚠ 覆盖面是**整份列表，含已摘除的那些**：摘掉一条也算「列表变了」。
 *   只对 `activeMounts` 求指纹会让「A 摘了 s1、B 同时挂上 s1」这一对并发
 *   算出同一个指纹 ⇒ 静默覆盖，正是 E5/V8 要挡的形状。
 * ⚠ 输入先按 `mountId` 排序：存储层的返回顺序不是契约的一部分，
 *   让它决定指纹会让「同一份列表读两次得到两个版本号」这种假冲突出现。
 * ⚠ 空列表有一个**确定的、非空的**指纹（sha256 of ""），不是 `""`：
 *   `""` 会与「调用方没填」在字符串层面撞上，而契约那边 `expectedVersion` 是必填的。
 */
export function mountListFingerprint(mounts: readonly ThreadSkillMount[]): string {
  const canonical = [...mounts]
    .sort((a, b) => (a.mountId < b.mountId ? -1 : a.mountId > b.mountId ? 1 : 0))
    .map((m) => `${m.mountId}:${m.skillId}:${m.versionId}:${m.removedAt ?? ""}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
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
