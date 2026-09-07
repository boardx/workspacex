import type { ChildCancellationStatus } from "@repo/contracts/run-control";
import { createHash } from "node:crypto";
import type { OrgId } from "../../domain/org-id";

export const PARENT_RUN_CONTROL = Symbol("ParentRunControl");
export const CHILD_RUN_CANCELLER = Symbol("ChildRunCanceller");
export interface ParentCancellation {
  readonly orgId: OrgId;
  readonly parentRunId: string;
  readonly requestId: string;
}
export type ChildCancellationResult = Exclude<ChildCancellationStatus, { kind: "not_requested" }>;
/** Implemented by the child runtime owner; confirmed means every scoped child is terminal. */
export interface ChildRunCanceller {
  cancelChildren(input: ParentCancellation): Promise<ChildCancellationResult>;
  readCancellation(input: ParentCancellation): Promise<ChildCancellationResult>;
}
export interface ParentCancellationReader {
  readCancellation(orgId: OrgId, parentRunId: string): Promise<ParentCancellation | null>;
}
/** Derived from the durable first cancellation timestamp; retries and restarts agree. */
export function parentCancelRequestId(orgId: OrgId, runId: string, requestedAt: Date | string): string {
  return createHash("sha256").update(JSON.stringify([orgId, runId, new Date(requestedAt).toISOString()])).digest("hex");
}
export class ParentRunControl {
  constructor(private readonly reader: ParentCancellationReader, private readonly children?: ChildRunCanceller) {}
  async readCancellation(orgId: OrgId, parentRunId: string): Promise<ChildCancellationResult | { kind: "not_requested" }> {
    const cancellation = await this.reader.readCancellation(orgId, parentRunId);
    if (!cancellation) return { kind: "not_requested" };
    if (!this.children) return { kind: "unavailable" };
    try { return await this.children.readCancellation(cancellation); }
    catch { return { kind: "unavailable" }; }
  }
  async propagateCancellation(orgId: OrgId, parentRunId: string): Promise<ChildCancellationResult | { kind: "not_requested" }> {
    const cancellation = await this.reader.readCancellation(orgId, parentRunId);
    if (!cancellation) return { kind: "not_requested" };
    if (!this.children) return { kind: "unavailable" };
    try { return await this.children.cancelChildren(cancellation); }
    catch { return { kind: "unavailable" }; }
  }
}
