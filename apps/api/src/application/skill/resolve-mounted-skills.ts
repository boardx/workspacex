/**
 * R3 步骤 7：现场按环节自动挂载（F64）。
 *
 * 依据：契约 `resolveMountedSkills`；`contracts/skills/usecases.md`「⚠ reason 是契约的一部分
 * ——AC1 要求『能看到因什么环节载入』」「组员侧只读：本用例返回的 mounts 对组员无任何
 * 写入口」。
 *
 * ⚠ 这是一个纯 GET 用例：**没有任何写变体**。「组员只读」在这里不是权限判断出来的，
 *   而是这个模块压根不导出一个能改 mounts 的函数——同 F63 端口白名单同一种落法：
 *   要让组员写，得先给这个模块加一个新导出，那是一次会被 review 看见的改动。
 */
import type { DeliverRole } from "../../domain/skill/binding-slot";
import { isDeliverRole } from "../../domain/skill/binding-slot";
import { mountedSkillBindingsFor, mountReasonFor } from "../../domain/skill/orchestration";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { MountHealthPort, ProjectOrchestrationStorePort } from "./ports";

export interface ResolveMountedSkillsInput {
  readonly projectId: string;
  readonly agendaSegmentId: string;
  readonly role: string;
  readonly groupId: string | null;
}

export interface ResolvedMount {
  readonly skillId: string;
  readonly versionId: string;
  readonly trigger: string;
  /** 例：「因环节 03 载入」。⚠ 不是可选的展示文案 */
  readonly reason: string;
  /** 非 null ⇒ 该条标「依赖失败」并说明原因，**不从列表里消失**（E2）。 */
  readonly disabledReason: string | null;
}

export type ResolveMountedSkillsResult =
  | { readonly ok: true; readonly mounts: readonly ResolvedMount[] }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface ResolveMountedSkillsDeps {
  readonly orchestrations: ProjectOrchestrationStorePort;
  readonly health: MountHealthPort;
}

export async function resolveMountedSkills(
  input: ResolveMountedSkillsInput,
  deps: ResolveMountedSkillsDeps,
): Promise<ResolveMountedSkillsResult> {
  if (!isDeliverRole(input.role) || input.role === "全场共用") {
    return {
      ok: false,
      code: "SKILL_NOT_FOUND",
      reason: `role 必须是三个人类角色之一，收到 ${input.role}`,
    };
  }
  const role: Exclude<DeliverRole, "全场共用"> = input.role;

  const orchestration = await deps.orchestrations.load(input.projectId);
  if (orchestration === null) {
    return { ok: false, code: "DEPENDENCY_UNAVAILABLE", reason: "该项目尚无编排" };
  }

  const reason = mountReasonFor(orchestration.segments, input.agendaSegmentId);
  const bindings = mountedSkillBindingsFor(orchestration, input.agendaSegmentId, role);

  const mounts: ResolvedMount[] = [];
  for (const b of bindings) {
    const health = await deps.health.checkAvailability(b.slot.skillId);
    mounts.push({
      skillId: b.slot.skillId,
      versionId: b.slot.versionId,
      trigger: b.trigger,
      reason,
      disabledReason: health.available ? null : health.reason,
    });
  }
  return { ok: true, mounts };
}
