/**
 * #493 —— `bindTemplateToSegment` 的两种失败，它们在契约的 `err` 联合里**都没有码**。
 *
 * 与 `errors.ts` 里 `CanvasIllegalTransitionError` /
 * `CanvasPublishedVersionConflictError` 逐字同型的处理，理由也逐字相同：给它们硬塞一个
 * 最像的 `CanvasError` 码，前端就会按那个码分支，而那个码在契约里的含义是另一件事。
 * ⇒ 两者都抛**不带 `reasonCode`** 的裸 HTTP，缺口报在 #493。
 *
 * 放在单独一个文件而不是塞进 `errors.ts`：`errors.ts` 的文件头明写它服务的是模板注册表
 * 那四个写操作，把绑定的失败面混进去，下一个人读那份文件头会以为它讲全了。
 */

/**
 * 议程环节不存在，或不在本组织。
 *
 * ⚠ 两种情况**同一个** 404：`agenda_segments` 走 RLS，别的组织的环节在这条路径上根本查不到，
 *   所以「不存在」与「不是你的」在这里本来就无从区分——这不是把两件事糊成一件，
 *   是它们在这个查询下确实是同一件（同 `SKILL_NOT_FOUND` 那条「不存在与范围外同一个出口，
 *   404 非 403，不泄露存在性」）。
 */
export class CanvasSegmentNotFoundError extends Error {
  constructor(readonly agendaSegmentId: string) {
    super(`agenda segment ${agendaSegmentId} not found`);
    this.name = "CanvasSegmentNotFoundError";
  }
}

/**
 * 这个议程环节已经绑过同一个 `templateKey` 了。
 *
 * 由唯一约束 `canvas_template_bindings_segment_key_uniq` 判定。
 *
 * ⚠ **不是** `SEGMENT_TEMPLATE_LIMIT`：上限那个码说的是「这个环节已经有两个模板了」，
 *   而这里可能只有一个。两者在界面上要说的话完全不同（「换个环节」vs「你已经绑过它了」），
 *   共用一个码就会让其中一句变成谎话。
 * ⚠ 也**不是**静默换绑：契约的 `in` 里没有任何「我知道它已存在、请覆盖」的表示，
 *   替调用方决定覆盖，就是把一次未经确认的改绑做成了默认行为。
 */
export class CanvasSegmentBindingExistsError extends Error {
  constructor(readonly templateKey: string) {
    super(`segment already has a binding for template ${templateKey}`);
    this.name = "CanvasSegmentBindingExistsError";
  }
}
