/**
 * 用例：预览参与者视图（F21 / 契约 `templates.previewParticipantView`，R6 第 7 步）。
 *
 * ⚠ **只读预览，不改变草稿状态、不产生版本**（契约逐字）——本文件因此没有任何写入，
 * 纯粹是对入参的投影 + 一次可见性过滤。
 *
 * ## 「组员可见性」今天筛不动 —— 记录为契约缺口，不假装已实现
 *
 * 契约 `templates.AgendaSegmentRef` 只有 `agendaSegmentId / title / addedBy / optional`
 * 四个字段，**没有任何标记「这一条组员能不能看见」**——`previewParticipantView` 的响应体
 * `visibleAgendaSegments` 用的还是这同一个 `AgendaSegmentRef`。也就是说，
 * 契约今天只能表达「给一份议程环节清单」，表达不了「同一份清单里有的条目对组员隐藏」。
 * 本用例因此把**全部传入的议程环节 / 材料原样当作可见**返回——这不是「组员可见性」
 * 这四个字要求的语义，而是契约在这一点上带不动那句话的诚实结果，与
 * `design-facet-table.ts` 的 `DESIGN_FACET_CONTRACT_GAP` 是同一种登记方式：
 * 改契约（给 `AgendaSegmentRef` 或响应体加一个可见性维度）是人类的动作，
 * 本文件不悄悄发明一个字段来假装已经解决。
 */
export const PARTICIPANT_VIEW_CONTRACT_GAP =
  "templates.AgendaSegmentRef has no member-visibility marker, so previewParticipantView " +
  "cannot actually filter by 组员可见性 today -- it echoes the draft's agenda segments and " +
  "materials as-is. Closing this needs a contract change (human action), not a guess here.";

export interface AgendaSegmentDraftRef {
  readonly agendaSegmentId: string;
  readonly title: string;
  readonly addedBy: string | null;
  readonly optional: boolean;
}

export interface ParticipantViewSnapshot {
  readonly blueprintId: string;
  readonly visibleAgendaSegments: readonly AgendaSegmentDraftRef[];
  readonly visibleMaterials: readonly string[];
}

export function previewParticipantView(input: {
  readonly blueprintId: string;
  readonly draftAgendaSegments: readonly AgendaSegmentDraftRef[];
  readonly draftMaterials: readonly string[];
}): ParticipantViewSnapshot {
  return {
    blueprintId: input.blueprintId,
    // ⚠ 见文件头 PARTICIPANT_VIEW_CONTRACT_GAP：今天恒等于「原样返回」，不是过滤后的结果。
    visibleAgendaSegments: input.draftAgendaSegments,
    visibleMaterials: input.draftMaterials,
  };
}
