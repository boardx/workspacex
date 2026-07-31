/**
 * R3 步骤 3–6：在某环节的**绑定槽**里换绑（F63）。
 *
 * 依据：契约 `upsertSegmentBinding`；domain.md I-8 / I-15 / I-17；UC-3.2 V7。
 *
 * ## 三条不变量在这里各有一个落点
 *
 * · **I-15 可区分**：槽内容先过 `parseSlotRef()`，往 skill 槽塞画布模板 ⇒ `SLOT_KIND_MISMATCH`。
 * · **I-8 记到版本**：`skill` 支缺 `versionId` 连构造都构造不出来（同一道门）。
 * · **I-17 不回写**：`target.level === "template"` 时**直接拒绝** `TEMPLATE_WRITEBACK_FORBIDDEN`，
 *   因为本用例只持有 `ProjectOrchestrationStorePort`（唯一可写的编排面）——
 *   它根本没有能写模板的端口。这条 `if` 是给出**可读的失败原因**，
 *   真正挡住回写的是端口清单本身（见 `ports.ts` 的 `TEMPLATE_PORTS_ALLOWED_METHODS`）。
 *
 * ⚠ 「超 6 个 skill」走 `warnings[]` **不进 err**（V7）：把建议做成错误码，
 *   引导师会在现场被一条建议卡住。
 */
import {
  bindingWarnings,
  parseSlotRef,
  isBindingTrigger,
  isDeliverRole,
  type BindingTrigger,
  type DeliverRole,
  type SegmentBinding,
} from "../../domain/skill/binding-slot";
import { withBinding, type ProjectOrchestration } from "../../domain/skill/orchestration";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { ProjectOrchestrationStorePort, SkillVisibilityPort } from "./ports";

export interface UpsertSegmentBindingInput {
  /**
   * 写哪一级。⚠ 联合而不是「两个可空 id」：`{projectId, templateId}` 那种形状里，
   * 「两个都填」是可表示的，而它正是一次静默回写。
   */
  readonly target:
    | { readonly level: "instance"; readonly projectId: string }
    | { readonly level: "template"; readonly templateId: string };
  readonly principalId: string;
  readonly agendaSegmentId: string;
  readonly bindingId: string;
  /** 原始槽内容，未经收窄。由 `parseSlotRef()` 决定它是三支中的哪一支，或者被拒。 */
  readonly slot: Readonly<Record<string, unknown>>;
  readonly deliverRoles: readonly string[];
  readonly trigger: string;
  /** 乐观并发（契约 `expectedVersion`）。⚠ 不匹配 ⇒ `SKILL_VERSION_CHANGED`，**不得静默覆盖** */
  readonly expectedFingerprint: string | null;
}

export type UpsertSegmentBindingResult =
  | {
      readonly ok: true;
      readonly binding: SegmentBinding;
      readonly orchestration: ProjectOrchestration;
      /** ⚠ 提示不阻断：超 6 个 skill 等情形进这里，**不进 err** */
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface UpsertSegmentBindingDeps {
  readonly orchestrations: ProjectOrchestrationStorePort;
  readonly skills: SkillVisibilityPort;
  /** 当前编排的指纹，用于乐观并发比对。注入是为了让测试能造一次真实的并发冲突。 */
  readonly fingerprintOf: (o: ProjectOrchestration) => string;
}

export async function upsertSegmentBinding(
  input: UpsertSegmentBindingInput,
  deps: UpsertSegmentBindingDeps,
): Promise<UpsertSegmentBindingResult> {
  if (input.target.level === "template") {
    return {
      ok: false,
      code: "TEMPLATE_WRITEBACK_FORBIDDEN",
      reason:
        "实例级写操作不得改模板本体（I-17）；沉淀回组织只有 [另存为组织模板] 一条显式路径",
    };
  }

  const parsed = parseSlotRef(input.slot);
  if (!parsed.ok) return { ok: false, code: parsed.code, reason: parsed.reason };

  const badRole = input.deliverRoles.find((r) => !isDeliverRole(r));
  if (badRole !== undefined) {
    return {
      ok: false,
      code: "SLOT_KIND_MISMATCH",
      reason: `下发角色 ${badRole} 不在封闭集合内（引导师 / 组长 / 组员 / 全场共用）`,
    };
  }
  if (!isBindingTrigger(input.trigger)) {
    return {
      ok: false,
      code: "SLOT_KIND_MISMATCH",
      reason: `触发方式 ${input.trigger} 不在封闭集合内（手动触发 / 默认开启 / 常驻）`,
    };
  }

  // 可绑定池 ＝ `已启用` ∩ 可见性范围覆盖当前用户（R3 步骤 3）。
  // ⚠ 只对 `skill` 支做这道判定：画布模板与 agent 产物的启用口径不在本束
  //   （07-canvas / UC-4.2）。把三支塞进同一条判定，就是把混合槽又糊回去。
  if (parsed.ref.kind === "skill") {
    const entry = await deps.skills.visibleTo({
      skillId: parsed.ref.skillId,
      principalId: input.principalId,
    });
    // I-14：不存在与范围外同一个出口，404 非 403，不泄露存在性。
    if (entry === null) {
      return { ok: false, code: "SKILL_NOT_FOUND", reason: "skill 不存在或不在可见性范围内" };
    }
    if (entry.status !== "已启用") {
      return {
        ok: false,
        code: "SKILL_NOT_ENABLED",
        reason: `只有「已启用」的 skill 进可绑定池，该 skill 当前为 ${entry.status}`,
      };
    }
  }

  const current = await deps.orchestrations.load(input.target.projectId);
  if (current === null) {
    return { ok: false, code: "DEPENDENCY_UNAVAILABLE", reason: "该项目尚无实例编排" };
  }
  if (
    input.expectedFingerprint !== null &&
    input.expectedFingerprint !== deps.fingerprintOf(current)
  ) {
    return {
      ok: false,
      code: "SKILL_VERSION_CHANGED",
      reason: "编排已被他人改动：乐观并发不匹配，不得静默覆盖",
    };
  }

  const binding: SegmentBinding = {
    bindingId: input.bindingId,
    agendaSegmentId: input.agendaSegmentId,
    owner: { level: "instance", projectId: input.target.projectId },
    slot: parsed.ref,
    deliverRoles: input.deliverRoles as readonly DeliverRole[],
    trigger: input.trigger as BindingTrigger,
    // 手工换绑出来的绑定**不是**任何模板绑定的副本。留一个假血缘，
    // 下一次「另存为组织模板」会把它当成继承来的内容。
    originTemplateBindingId: null,
  };

  const next = withBinding(current, binding);
  await deps.orchestrations.save(next);

  const sameSegment = next.bindings.filter((b) => b.agendaSegmentId === input.agendaSegmentId);
  return { ok: true, binding, orchestration: next, warnings: bindingWarnings(sameSegment) };
}
