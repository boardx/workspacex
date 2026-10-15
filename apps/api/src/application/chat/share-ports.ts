import type { chatShare } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export interface StoredShare {
  readonly id: string;
  readonly threadId: string;
  readonly createdBy: string;
  readonly tokenHash: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly snapshot: Guarded<chatShare.SnapshotValue>;
}
export interface ChatShareRepository {
  insert(orgId: OrgId, input: { id: string; threadId: string; createdBy: string; tokenHash: string; snapshot: chatShare.SnapshotValue }): Promise<chatShare.ShareValue>;
  list(orgId: OrgId, threadId: string, createdBy: string): Promise<chatShare.ShareValue[]>;
  revoke(orgId: OrgId, threadId: string, createdBy: string, shareId: string): Promise<boolean>;
  findByTokenHash(tokenHash: string): Promise<StoredShare | null>;
}
