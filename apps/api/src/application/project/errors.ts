/**
 * `project` 束的失败面 —— 一个类，携带契约 `project.ProjectReason` 的一个成员。
 *
 * 一个类而不是每码一个类：同 `OrgAdminError` / `AuthError` 的理由——interface 层把它们
 * 映射成同一种响应形状，分成多个类会引来分别 `catch`，然后两个码长出两种响应形状。
 *
 * ⚠ 码是**契约里的闭合枚举**，不是自由字符串：`ProjectReason` 的每一个成员都必须在
 *   某个操作的 `err` 里出现（契约文件头逐字），所以这里也不许多造一个。
 */
import { project } from "@repo/contracts";
import type { z } from "zod";

export type ProjectReasonCode = z.infer<typeof project.ProjectReason>;

export class ProjectError extends Error {
  readonly reasonCode: ProjectReasonCode;

  constructor(reasonCode: ProjectReasonCode) {
    // 消息只进日志（`lint-error-leak` 禁止 interface 层读 `.message`）。
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "ProjectError";
  }
}

/**
 * F124 / U-2⑵ ——「有 `active` 议程环节时拒绝归档」已被人类裁决采纳，
 * 但该裁决**故意没有给失败码命名**（`packages/contracts/src/project.ts` 的
 * `KNOWN_CONTRACT_GAPS.P7` 逐字：「本文件不发明它」），`archiveProject.err`
 * 因此只有 `["ORG_ROLE_INSUFFICIENT","PROJECT_ARCHIVED","AUTH_SERVICE_UNAVAILABLE"]`
 * 三个成员，表达不了这个已裁定的失败。
 *
 * ⚠ 这不是 `ProjectError` 的第四个 `reasonCode`：`ProjectReason` 是闭合枚举，
 * 每个成员都必须出现在某个操作的 `err` 里（契约文件头逐字），凭空加一个
 * 未经签核的字面量等于把「补码」这件签核动作偷偷做成了实现动作。
 *
 * ⇒ 本类**不携带** `reasonCode`。`interface` 层拿到它时只能抛一个不带
 * `reasonCode` 字段的裸 400（见 `interface/controllers/project.controller.ts`），
 * 这正是 feature notes 里写的「只能落成一个没有码的 400」——如实反映契约现状，
 * 不去发明一个看起来更完整、实际上没有签核背书的响应形状。
 *
 * 开工前已按 issue 要求把「需要人类补一个码名」这件事报了上去；在补码之前，
 * 调用方（前端 / 未来的脚本消费者）拿不到一个可判等的字符串来分支这个失败，
 * 只能按裸 400 处理。这是已知的、报告过的行为，不是本 feature 的疏漏。
 */
export class ProjectArchiveBlockedByActiveSegmentError extends Error {
  constructor() {
    super("archive rejected: workshop has an active agenda segment (U-2(2), code intentionally unnamed — see KNOWN_CONTRACT_GAPS.P7)");
    this.name = "ProjectArchiveBlockedByActiveSegmentError";
  }
}
