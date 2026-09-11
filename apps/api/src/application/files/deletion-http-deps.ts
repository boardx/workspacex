import type { RequestDeletionDeps } from "./request-deletion";
import type { ReadDeletionStatusDeps } from "./read-deletion-status";
import type { OrgId } from "../../domain/org-id";
import type { OutboundPortImpl } from "@repo/contracts/files-outbound-stubs";
export type DeletionHttpDeps = RequestDeletionDeps & ReadDeletionStatusDeps & {
  transaction<T>(orgId: OrgId, work: () => Promise<T>): Promise<T>;
  ontologyEdgesForOrg(orgId: OrgId): OutboundPortImpl;
};
export const DELETION_HTTP_DEPS = Symbol("DeletionHttpDeps");
