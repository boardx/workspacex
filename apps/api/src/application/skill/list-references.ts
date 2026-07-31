/**
 * 停用前置：引用枚举三类（F66；契约 `listReferences`，UC-3.4 R3 分支 B 步骤 6、AC4）。
 *
 * ⚠ 三类各自独立查询、独立可能失败——一类查询抛错不得让另外两类也交不出结果
 *   （同 `ports.ts` 里 `ReferenceEnumerationPort` 三个方法分开的理由）。
 *   本用例目前的落法是**同步等三类都跑完**；`asyncTaskId` 的字段留在契约与
 *   `ReferenceSnapshot` 里给未来的分页/异步实现用，本函数**恒返回 null**——
 *   R9「3 秒内返回或转异步」的异步分支尚未实现，写 `null` 而不是编一个假的任务 id
 *   是诚实地留一个已知空白，不是遗漏。
 */
import type { ReferenceSnapshot } from "../../domain/skill/reference-enumeration";
import type { ReferenceEnumerationPort, ReferenceSnapshotStorePort } from "./ports";

export interface ListReferencesInput {
  readonly skillId: string;
  readonly newSnapshotId: () => string;
}

export async function listReferences(
  input: ListReferencesInput,
  deps: {
    readonly enumeration: ReferenceEnumerationPort;
    readonly snapshots: ReferenceSnapshotStorePort;
  },
): Promise<ReferenceSnapshot> {
  const [inFlightProjects, templateBindings, agentMounts] = await Promise.all([
    deps.enumeration.inFlightProjects(input.skillId),
    deps.enumeration.templateBindings(input.skillId),
    deps.enumeration.agentMounts(input.skillId),
  ]);

  const snapshot: ReferenceSnapshot = {
    referenceSnapshotId: input.newSnapshotId(),
    skillId: input.skillId,
    inFlightProjects,
    templateBindings,
    agentMounts,
    asyncTaskId: null,
  };

  // ⚠ 空清单**照样落库**——A1 要求空态本身可被后续 `disableSkill` 的
  //   `referenceSnapshotId` 校验引用到，而不是「反正没有引用，不落一条清单直接放行」。
  //   落不落库不取决于清单内容。
  await deps.snapshots.save(snapshot);
  return snapshot;
}
