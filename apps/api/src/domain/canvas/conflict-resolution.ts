/**
 * F105 — 结构性冲突：`applyStructuralChange` 的产生规则 + `resolveConflict` 三出口（D-09）。
 *
 * ⚠ **单侧改结构直接同步、不弹冲突条；只有两侧同时改才产生 `conflictId`**（I-16）。
 * ⚠ **`preservedVersionId` 永不为空是 D-09 的价值核心**（I-17）：三个出口
 *   [并排比较]/[保留文档]/[保留画布] 任意一个丢弃另一侧即数据损坏——本模块
 *   的类型层就不给"丢掉另一侧"留位置，`resolveConflict` 的返回类型里
 *   `preservedVersionId` 是必填的非空字符串，不是可选/可空字段。
 * ⚠ **幂等重放**：重复裁决同一 `conflictId` 返回既有结果，不重复建版本
 *   （`CONFLICT_ALREADY_RESOLVED`，与契约错误码同名）。
 * ⚠ **部分成功即数据损坏**：采纳侧写入与另一侧存版本必须是同一次调用里的
 *   同一个返回值——本模块把两件事绑在一个函数里返回一个结果对象，
 *   不提供"先写采纳侧、再补一个单独调用去存另一侧"的两步 API，
 *   因为两步 API 天然给"中途失败留一半"留了缝。
 */
import type { z } from "zod";
import { canvas as C } from "@repo/contracts";

export type ChangeSide = z.infer<typeof C.ChangeSide>;
export type ConflictOutcome = z.infer<typeof C.ConflictOutcome>;

/* ─────────────────────── applyStructuralChange：冲突何时产生 ─────────────────────── */

/** 一次结构性写的记录——用于判定"两侧是否都改过"。 */
export interface StructuralEdit {
  readonly side: ChangeSide;
  readonly versionId: string;
  readonly authorRef: string;
  readonly at: string;
  readonly summary: string;
}

export type ApplyStructuralChangeResult =
  | { readonly kind: "synced"; readonly versionId: string }
  | {
      readonly kind: "conflict";
      readonly conflictId: string;
      readonly docSide: StructuralEdit;
      readonly canvasSide: StructuralEdit;
    };

/**
 * 提交一次结构性改动。`pendingOtherSide` = 同一 `instanceId` 上，**另一侧**
 * 是否已经有一条未同步的结构性改动在等着。
 *
 * ⚠ 只有当"这一次提交的侧" 与 "已经存在的、另一侧未同步的改动" 两者都非空时，
 *   才产生 `conflictId`——单侧改结构，哪怕改了很多次，只要另一侧没动过，
 *   就直接同步生效，不弹冲突条（I-16）。
 */
export function applyStructuralChange(params: {
  readonly side: ChangeSide;
  readonly thisEdit: Omit<StructuralEdit, "side">;
  readonly pendingOtherSide: StructuralEdit | null;
  readonly makeConflictId: () => string;
}): ApplyStructuralChangeResult {
  const { side, thisEdit, pendingOtherSide } = params;
  const thisSideEdit: StructuralEdit = { side, ...thisEdit };

  if (pendingOtherSide === null) {
    // 另一侧没有未同步的结构性改动 —— 单侧改结构，直接同步。
    return { kind: "synced", versionId: thisEdit.versionId };
  }

  const docSide = side === "doc" ? thisSideEdit : pendingOtherSide;
  const canvasSide = side === "canvas" ? thisSideEdit : pendingOtherSide;
  return { kind: "conflict", conflictId: params.makeConflictId(), docSide, canvasSide };
}

/* ─────────────────────────────── resolveConflict：三出口 ─────────────────────────────── */

export interface PendingConflict {
  readonly conflictId: string;
  readonly docSide: StructuralEdit;
  readonly canvasSide: StructuralEdit;
}

export interface ResolvedConflict {
  readonly conflictId: string;
  readonly outcome: ConflictOutcome;
  readonly adoptedVersionId: string;
  /** ⚠ 永不为空——D-09 的价值核心（I-17）。 */
  readonly preservedVersionId: string;
}

export type ResolveConflictResult =
  | { readonly ok: true; readonly result: ResolvedConflict; readonly alreadyResolved: false }
  | { readonly ok: true; readonly result: ResolvedConflict; readonly alreadyResolved: true }
  | { readonly ok: false; readonly reason: "INSTANCE_NOT_FOUND" };

/**
 * 三出口的纯判定核心。
 *
 * - `outcome: "compare"` —— **中间态，不是终态**：两侧都不被"采纳"也不被"丢弃"，
 *   只是把并排差异视图准备好；`adoptedVersionId` 与 `preservedVersionId` 在这一支
 *   里**仍然各自指向自己的版本**（谁都没被覆盖），因为冲突尚未真正解除——
 *   调用方后续还会带着 `keep-doc` / `keep-canvas` 再调一次本函数。
 * - `outcome: "keep-doc"` —— 采纳文档侧（`adoptedVersionId = docSide.versionId`），
 *   画布侧存为一个版本（`preservedVersionId = canvasSide.versionId`）。
 * - `outcome: "keep-canvas"` —— 反过来。
 *
 * ⚠ **幂等重放**：`alreadyResolvedByConflictId` 命中时，直接回放**上一次的结果**
 *   （包括当初的 `preservedVersionId`），而不是重新走一遍判定逻辑——重放不能
 *   因为传了不同的 `outcome` 就产生第二个 `preservedVersionId`，那会让
 *   "重复裁决" 这件事本身变成第二次数据分叉。
 */
export function resolveConflict(params: {
  readonly instanceExists: boolean;
  readonly conflict: PendingConflict;
  readonly outcome: ConflictOutcome;
  readonly alreadyResolvedByConflictId: ResolvedConflict | undefined;
}): ResolveConflictResult {
  if (!params.instanceExists) return { ok: false, reason: "INSTANCE_NOT_FOUND" };

  if (params.alreadyResolvedByConflictId) {
    return { ok: true, result: params.alreadyResolvedByConflictId, alreadyResolved: true };
  }

  const { conflict, outcome } = params;

  if (outcome === "compare") {
    // 中间态：两侧各自"保留自己"，冲突未消失，仍待再次裁决。
    return {
      ok: true,
      alreadyResolved: false,
      result: {
        conflictId: conflict.conflictId,
        outcome,
        adoptedVersionId: conflict.docSide.versionId,
        preservedVersionId: conflict.canvasSide.versionId,
      },
    };
  }

  const adopted = outcome === "keep-doc" ? conflict.docSide : conflict.canvasSide;
  const preserved = outcome === "keep-doc" ? conflict.canvasSide : conflict.docSide;

  return {
    ok: true,
    alreadyResolved: false,
    result: {
      conflictId: conflict.conflictId,
      outcome,
      adoptedVersionId: adopted.versionId,
      preservedVersionId: preserved.versionId,
    },
  };
}

/**
 * 断言辅助：给定一次 `resolveConflict` 的真实终态结果（`keep-doc` / `keep-canvas`），
 * 校验"另一侧确实被存为版本"——`preservedVersionId` 非空、且不等于
 * `adoptedVersionId`（两者必须是两个不同的版本，而不是同一个版本被塞进两个字段）。
 */
export function assertOtherSidePreserved(result: ResolvedConflict): boolean {
  if (result.outcome === "compare") return true; // 中间态不做这条终态断言
  return result.preservedVersionId.length > 0 && result.preservedVersionId !== result.adoptedVersionId;
}
