import type { OrgId } from "../../domain/org-id";
export const deletionLockKey = (orgId: OrgId): string => `physical-deletion:${orgId}`;
