/**
 * `projectEvidence` 束的失败面 —— 一个类，携带契约 `projectEvidence.ProjectEvidenceReason` 的一个成员。
 *
 * 不复用 `ProjectError`：它的码是 `project.ProjectReason` 的闭合枚举，而 `EVIDENCE_NOT_FOUND` 只在
 * `projectEvidence` 束里声明（契约文件头：每个成员都必须出现在某个操作的 `err` 里）。两个束、两个枚举、
 * 两个类；interface 层各自映射成同一种响应形状 `{ reasonCode }`。
 */
import type { projectEvidence as C } from "@repo/contracts";
import type { z } from "zod";

export type ProjectEvidenceReasonCode = z.infer<typeof C.ProjectEvidenceReason>;

export class ProjectEvidenceError extends Error {
  readonly reasonCode: ProjectEvidenceReasonCode;

  constructor(reasonCode: ProjectEvidenceReasonCode) {
    // 消息只进日志（`lint-error-leak` 禁止 interface 层读 `.message`）。
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "ProjectEvidenceError";
  }
}
