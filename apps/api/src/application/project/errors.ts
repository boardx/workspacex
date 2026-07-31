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
