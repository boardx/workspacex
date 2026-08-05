/**
 * R3 步骤 1–2：把一个或多个 skill 临时挂到当前对话线程（F65）。
 *
 * 依据：契约 `mountSkillToThread`；domain.md I-18（作用域）；UC-3.3 R5/R7/E1。
 *
 * ## 两条不变量各有一个落点
 *
 * · **I-18 只对当前线程生效**：本用例的唯一可写端口 `ThreadMountStorePort` 只认
 *   `threadId`（见 `ports.ts`），且依赖清单里**没有** `ProjectOrchestrationStorePort`——
 *   这个用例结构上拿不到任何能改蓝本/实例编排的东西。
 * · **组员/未获下放的组长拒绝在服务端**（V4）：`isSelfMountAllowed` 判定为 false 时
 *   直接拒绝并写安全审计，**在做任何可见性/挂载判断之前**——越权尝试不应该
 *   透出「这个 skill 存不存在」之类的次级信息。
 *
 * ⚠ 临时挂载**不构成提权**（R9）：本用例不引入任何新的数据范围判定，
 *   运行时读数据仍然只能走 `ContextApiPort`（I-25），与蓝本绑定同一条通路、同一套三层权限。
 */
import { isDeliverRole, type DeliverRole } from "../../domain/skill/binding-slot";
import {
  isSelfMountAllowed,
  mountOne,
  type ThreadSkillMount,
} from "../../domain/skill/thread-mount";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type { SecurityAuditPort, SkillVisibilityPort, ThreadMountStorePort } from "./ports";

export interface MountSkillToThreadInput {
  readonly threadId: string;
  readonly principalId: string;
  /** 原始角色字符串，未经收窄——服务端判定，不信任前端隐藏入口。 */
  readonly role: string;
  readonly skillIds: readonly string[];
  /** 新挂载条目的 id 生成器：测试给可预期的值，生产由调用方接 uuid。 */
  readonly mountIdFor: (index: number) => string;
  readonly mountedAt: string;
  /** 乐观并发（契约 `expectedVersion`）。⚠ 不匹配 ⇒ `SKILL_VERSION_CHANGED`，不得静默覆盖（E5/V8） */
  readonly expectedFingerprint: string | null;
}

export type MountSkillToThreadResult =
  | { readonly ok: true; readonly mounts: readonly ThreadSkillMount[] }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface MountSkillToThreadDeps {
  readonly mounts: ThreadMountStorePort;
  readonly skills: SkillVisibilityPort;
  readonly audit: SecurityAuditPort;
  /** 当前线程挂载列表的指纹，用于乐观并发比对（同 F63 `fingerprintOf` 的落法）。 */
  readonly fingerprintOf: (mounts: readonly ThreadSkillMount[]) => string;
}

export async function mountSkillToThread(
  input: MountSkillToThreadInput,
  deps: MountSkillToThreadDeps,
): Promise<MountSkillToThreadResult> {
  const role = isDeliverRole(input.role) ? input.role : null;
  if (role === null || !isSelfMountAllowed(role as DeliverRole)) {
    await deps.audit.record({
      kind: "skill-member-self-mount-attempt",
      principalId: input.principalId,
      detail: `role=${input.role} 试图在 thread=${input.threadId} 自行挂载 skill（${input.skillIds.join(",")}），服务端拒绝`,
    });
    return {
      ok: false,
      code: "MEMBER_CANNOT_SELF_MOUNT",
      reason: "组员不能自行挂载 skill；组长的下放开关尚未落地（S3），同样拒绝",
    };
  }

  const current = await deps.mounts.load(input.threadId);
  if (
    input.expectedFingerprint !== null &&
    input.expectedFingerprint !== deps.fingerprintOf(current)
  ) {
    return {
      ok: false,
      code: "SKILL_VERSION_CHANGED",
      reason: "挂载列表已被他人改动：乐观并发不匹配，不得静默覆盖",
    };
  }

  let next = current;
  const newlyMounted: ThreadSkillMount[] = [];
  for (const [index, skillId] of input.skillIds.entries()) {
    const entry = await deps.skills.visibleTo({ skillId, principalId: input.principalId });
    // I-14 同一出口：不存在与可见性范围外都判 SKILL_NOT_FOUND，不泄露存在性。
    if (entry === null) {
      return { ok: false, code: "SKILL_NOT_FOUND", reason: "skill 不存在或不在可见性范围内" };
    }
    // ⚠ **状态判在版本号之前，顺序本身是判据的一部分**（#552）。
    //   未获批准的 skill 恒 `currentVersionId === null`。反过来先要版本号，一条
    //   「待审核」的 skill 就会被说成「不存在」—— 而它明明列在使用者自己的目录里。
    //   `SKILL_NOT_ENABLED` 告诉他「去走门禁」；`SKILL_NOT_FOUND` 只会让他以为自己看错了。
    if (entry.status !== "已启用") {
      return {
        ok: false,
        code: "SKILL_NOT_ENABLED",
        reason: `只有「已启用」的 skill 可临时挂载，该 skill 当前为 ${entry.status}`,
      };
    }
    // 走到这里 `status` 必是 `已启用`，而那蕴含有生效版本（`releaseVersion` 在**同一个
    // 事务**里置 `state='已生效'` 与 `current_version_id`）。仍然显式判一次而不是 `!`：
    // 这条蕴含关系靠的是另一个文件里的事务边界，不是类型系统 —— 它哪天被拆成两次写入，
    // 这里要以一个说得出口的失败告终，而不是把空版本号写进挂载记录。
    if (entry.currentVersionId === null) {
      return {
        ok: false,
        code: "SKILL_NOT_ENABLED",
        reason:
          "该 skill 标记为已启用却没有生效版本：挂载记录写不出「当时挂的是哪一版」，拒绝挂载（数据不一致）",
      };
    }
    const mounted: ThreadSkillMount = {
      mountId: input.mountIdFor(index),
      threadId: input.threadId,
      skillId,
      versionId: entry.currentVersionId,
      mountedAt: input.mountedAt,
      removedAt: null,
    };
    next = mountOne(next, mounted);
    newlyMounted.push(mounted);
  }

  await deps.mounts.save(input.threadId, next);
  return { ok: true, mounts: newlyMounted };
}
