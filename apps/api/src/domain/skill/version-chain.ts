/**
 * **版本快照不可变 + 版本链 + 发新版旧版自动归档**（F66；`contracts/skills/domain.md`
 * `SkillVersion` / I-6，裁决 D-30；UC-3.4 R3 分支 A、R7）。
 *
 * 参照系是**画布模板**（`domain/templates/blueprint-version.ts`）——UC-3.4 R1 逐字
 * 「本用例的版本语义参照画布模板」。本文件的形状因此刻意与它同构：
 * 版本号单调递增不复用、发布失败不占号、归档只挡新建不挡存量。
 *
 * ## 与 F63 的边界：谁管什么
 *
 * 「已建实例记着自己用的是哪个版本、发新版不影响它」这条不变量本身
 * （`resolveBoundVersion`）已经在 `orchestration.ts` 里实现并被
 * `binding-version-snapshot.test.ts`（F63）测过——本文件**不重新实现锁定行为**，
 * 只提供 `toVersionCatalogEntry` 把这里的版本链**投影**成那边吃的
 * `SkillVersionCatalogEntry` 形状。两处若各自维护一份「现在生效的是哪版」，
 * 就是本仓已经漂过五次的第二事实源；这里选择**只有版本链一份权威**，
 * 编排侧只读它的投影。
 *
 * 本文件独有的三件事：
 *   ① 版本快照一旦写入即不可变（`Object.freeze`，同 `agent/version-snapshot.ts` 的理由：
 *      "从不写它" 是纪律，"写了就 throw" 是结构）。
 *   ② 版本号序列的不变量（单调递增 / 不复用 / 不缺号 / 发布失败不占号）。
 *   ③ 发新版 vN+1 生效 ⇒ vN **自动归档**，且**恰好同时只有一个「已生效」**。
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import { skills } from "@repo/contracts";
import type { DeclarativeContract } from "./declarative-contract";
import type { SkillVersionCatalogEntry } from "./orchestration";
import type { SkillLifecycleStatus } from "./skill-status";

/** 五态，从契约派生、不重写（ADR-020）。⚠ `已归档` 在版本链**是**一个独立取值——
 *  这与 `Skill.status` 里「已归档不单列」是两个不同字段的两条不同规则
 *  （`skill-status.ts` 头部注释已交代：版本状态与 skill 状态不得互相推导）。 */
export type SkillVersionState = z.infer<typeof skills.SkillVersionState>;

/**
 * 一条**不可变**版本快照。
 *
 * ⚠ `content` 与整条记录一起冻结：`declarativeContract` 是一个普通对象字面量，
 *   不冻结的话 `dataScope` 数组能被 `.push()` 悄悄改动，
 *   而「发布后永不改变」这条承诺就只活在文档里。
 */
export interface SkillVersionSnapshot {
  readonly versionId: string;
  readonly skillId: string;
  /** I-3 同款判据：一个 skill 内单调递增、不复用、不缺号。 */
  readonly versionNumber: number;
  readonly content: DeclarativeContract;
  /** 发布后永不改变的正文哈希（sha256/hex）。 */
  readonly contentHash: string;
  readonly state: SkillVersionState;
}

function stableEncode(content: DeclarativeContract): Uint8Array {
  const ordered = Object.keys(content)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = (content as Record<string, unknown>)[k];
      return acc;
    }, {});
  return new TextEncoder().encode(JSON.stringify(ordered));
}

/** 复用 artifact 束已有的 sha256 实现，不重写第二个哈希函数（同一件事只有一处算法）。 */
export function contentHashOf(content: DeclarativeContract): string {
  return createHash("sha256").update(stableEncode(content)).digest("hex");
}

function deepFreeze<T>(v: T): T {
  if (Array.isArray(v)) {
    v.forEach(deepFreeze);
  } else if (v !== null && typeof v === "object") {
    Object.values(v as Record<string, unknown>).forEach(deepFreeze);
  }
  return Object.freeze(v);
}

/**
 * 下一个版本号。⚠ 取历史最大号 + 1，不是「已生效版本数 + 1」——
 * 归档后计数会缩水但号不能倒退（同 `blueprint-version.ts` 的 `nextVersionNumber`）。
 * 空历史 ⇒ 1。
 */
export function nextVersionNumber(history: readonly SkillVersionSnapshot[]): number {
  return history.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
}

/** 版本号序列满足单调递增、不复用、不缺号（发布失败不占号 ⇒ 序列本身就该是 1..N 连续）。 */
export function versionNumbersMonotonic(history: readonly SkillVersionSnapshot[]): boolean {
  const numbers = history.map((v) => v.versionNumber).sort((a, b) => a - b);
  return numbers.every((n, i) => n === i + 1);
}

/**
 * R3 步骤 1：把改动落为 `vN+1 · 草稿`，**不覆盖当前生效版本**。
 *
 * ⚠ 返回的是一条**新**记录、且立即冻结——它此后不经过任何「编辑草稿」的路径；
 *   要改内容只能再提交一次，产生另一个 `versionId`（与画布模板 I-2 同理）。
 */
export function createDraftVersion(
  history: readonly SkillVersionSnapshot[],
  input: { readonly versionId: string; readonly skillId: string; readonly content: DeclarativeContract },
): SkillVersionSnapshot {
  return deepFreeze({
    versionId: input.versionId,
    skillId: input.skillId,
    versionNumber: nextVersionNumber(history),
    content: input.content,
    contentHash: contentHashOf(input.content),
    state: "草稿",
  });
}

export class VersionChainError extends Error {
  constructor(readonly code: "VERSION_NOT_FOUND" | "VERSION_NOT_PENDING_REVIEW") {
    super(code);
  }
}

/**
 * I-6：`vN+1` 门禁通过 ⇒ 生效；**`vN` 自动归档**（画布模板同款语义）。
 *
 * ⚠ 门禁本身（安全扫描 + 方法论审核、提交人≠审核人）不在这里重做——那是 F62 的范围，
 *   本函数的前置条件是「调用方已经确认门禁通过」，只管版本链这一侧的结果：
 *   恰好同时只有一个 `已生效`，且被顶替的那个转 `已归档`。
 * ⚠ 归档**不删除、不清空 `contentHash`**——I-6 的后半句「已建实例记着自己用的是
 *   哪个版本」要求历史正文永远可解析，归档只是状态字段的变化。
 */
export function releaseVersion(
  history: readonly SkillVersionSnapshot[],
  versionId: string,
): {
  readonly history: readonly SkillVersionSnapshot[];
  /** 被顶替、随之自动归档的旧生效版本；首次发布时为 null。 */
  readonly archivedVersionId: string | null;
} {
  const target = history.find((v) => v.versionId === versionId);
  if (target === undefined) throw new VersionChainError("VERSION_NOT_FOUND");
  if (target.state !== "待审核") throw new VersionChainError("VERSION_NOT_PENDING_REVIEW");

  const previousEffective = history.find((v) => v.state === "已生效") ?? null;

  const nextHistory = history.map((v) => {
    if (v.versionId === target.versionId) return deepFreeze({ ...v, state: "已生效" as const });
    if (previousEffective !== null && v.versionId === previousEffective.versionId) {
      return deepFreeze({ ...v, state: "已归档" as const });
    }
    return v;
  });

  return { history: deepFreeze(nextHistory), archivedVersionId: previousEffective?.versionId ?? null };
}

/** 断言方式：恰好同时只有一个「已生效」——发新版之后这条必须始终成立。 */
export function exactlyOneEffective(history: readonly SkillVersionSnapshot[]): boolean {
  return history.filter((v) => v.state === "已生效").length <= 1;
}

/**
 * E5（`待上线`）：门禁复核通过但发版本身失败（例如并发冲突）时，提案停在 `待上线`，
 * `vN` **保持生效**——不产生「悄悄换了正文却没人知道」的中间态。
 */
export function markPendingRelease(
  history: readonly SkillVersionSnapshot[],
  versionId: string,
): readonly SkillVersionSnapshot[] {
  return deepFreeze(
    history.map((v) => (v.versionId === versionId ? deepFreeze({ ...v, state: "待上线" as const }) : v)),
  );
}

/**
 * 版本链 → `orchestration.ts` 吃的目录形状（**唯一的投影处**，见文件头）。
 *
 * ⚠ `currentVersionId` 取「已生效」的那一条；链上还没有任何生效版本时（skill 刚建、
 *   仍在走首次上线门禁）取空串——`resolveBoundVersion` 对空目录本就返回
 *   `contentHash: null`，不需要在这里编一个假的当前版本出来。
 */
export function toVersionCatalogEntry(
  skillId: string,
  history: readonly SkillVersionSnapshot[],
  status: SkillLifecycleStatus,
): SkillVersionCatalogEntry {
  const effective = history.find((v) => v.state === "已生效");
  return {
    skillId,
    status,
    currentVersionId: effective?.versionId ?? "",
    contentHashByVersion: Object.fromEntries(history.map((v) => [v.versionId, v.contentHash])),
  };
}
