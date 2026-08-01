/**
 * 归档与删除的引用计数门控（F30 / O-18 ① ③，`uc-2-4` R4 A1/A3 · R10 · V7b/V7c）。
 *
 * 纯函数：没有时钟、没有 I/O。引用计数由调用方查出后传入。
 *
 * ## 三条裁决落在这里
 *
 * · **删除 = 引用计数门控**（O-18 ①）：`referencingProjectCount > 0` ⇒ 不可删除，
 *   只能归档；`= 0` ⇒ 允许物理删除。**没有 `force` / `cascade` 参数能绕过这条**——
 *   本文件的门控函数签名里也确实没有这样一个参数。
 * · **归档不禁止存量实例化**（O-18 ③ / 复用 O-10）：归档只影响「能不能新增绑定」，
 *   这条已经在 `blueprint-version.ts` 的 `canBindNewProject` / `canInstantiateExistingBinding`
 *   两个函数里落实，本文件不重复。
 * · **二次确认**：归档 / 删除都要求 `confirmed: true`，否则 `NEEDS_CONFIRMATION`，
 *   且确认框文案需要「有 N 个项目仍引用」这个数字（本文件把它算出来，不猜）。
 */

export interface ReferenceCounts {
  readonly referencingProjectCount: number;
  readonly referencingAgendaSegmentCount: number;
}

export type DeleteGateVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "BLUEPRINT_IN_USE"; readonly referencingProjectCount: number }
  | { readonly allowed: false; readonly reason: "NEEDS_CONFIRMATION" };

/**
 * 删除门。⚠ 判定顺序刻意是「先查引用计数，再查确认」——
 * 一个被套用过的蓝本，就算传了 `confirmed: true` 也必须先被引用计数挡住，
 * 而不是先问「你确认吗」再告诉用户其实做不到。
 */
export function evaluateDeleteGate(
  counts: Pick<ReferenceCounts, "referencingProjectCount">,
  confirmed: boolean,
): DeleteGateVerdict {
  if (counts.referencingProjectCount > 0) {
    return {
      allowed: false,
      reason: "BLUEPRINT_IN_USE",
      referencingProjectCount: counts.referencingProjectCount,
    };
  }
  if (!confirmed) return { allowed: false, reason: "NEEDS_CONFIRMATION" };
  return { allowed: true };
}

export type ArchiveGateVerdict =
  | { readonly allowed: true; readonly counts: ReferenceCounts }
  | { readonly allowed: false; readonly reason: "NEEDS_CONFIRMATION"; readonly counts: ReferenceCounts };

/**
 * 归档门。⚠ 归档本身**不看引用计数**——有没有项目引用都可以归档
 * （归档只是「不再允许新增绑定」，不是「因为没人用了才归档」）。
 * 唯一的门是二次确认，且确认框必须能拿到 `counts` 去拼「有 N 个项目 / N 个议程环节仍引用」。
 */
export function evaluateArchiveGate(counts: ReferenceCounts, confirmed: boolean): ArchiveGateVerdict {
  if (!confirmed) return { allowed: false, reason: "NEEDS_CONFIRMATION", counts };
  return { allowed: true, counts };
}

/**
 * 行操作里 `[× 删除]` 是否要换成 `[归档]`（列表页派生，`uc-2-4` R3 步骤 5 表格最后一行）。
 * ⚠ 前端不得自行判断——这条判据必须与 `evaluateDeleteGate` 共用同一个
 *   `referencingProjectCount > 0` 阈值，否则列表页显示的按钮与真正调用时的门控可能对不上。
 */
export function deleteButtonReplacedByArchive(referencingProjectCount: number): boolean {
  return referencingProjectCount > 0;
}
