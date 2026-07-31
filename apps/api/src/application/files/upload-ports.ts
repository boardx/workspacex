/**
 * F35 ports: the malware-quarantine trail and the security alert side effect.
 *
 * Kept separate from `application/artifact/ports.ts` (F04) and `application/files/ports.ts`
 * (F31/F32): those are read-side and materialization ports this feature reuses unchanged;
 * this file is the one new concern F35 actually adds.
 */
import type { OrgId } from "../../domain/org-id";

export interface NewQuarantineRecord {
  readonly orgId: OrgId;
  readonly projectId: string | null;
  readonly filename: string;
  readonly contentHash: string;
  readonly scanVerdict: string;
  readonly uploadedBy: string;
  /** Whether `SecurityAlertPort.raise()` actually succeeded for this record. */
  readonly alerted: boolean;
}

export interface QuarantineRepository {
  /** Appends a non-downloadable trace of a rejected file. Never overwritten, never deleted. */
  record(entry: NewQuarantineRecord): Promise<void>;
}

export const QUARANTINE_REPOSITORY = Symbol("QuarantineRepository");

export interface SecurityAlert {
  readonly orgId: OrgId;
  readonly kind: "malware-detected";
  readonly filename: string;
  readonly contentHash: string;
  readonly detail: string;
}

/**
 * Raises a security alert. A port because "an alert was raised" (V4 ③) has to be
 * assertable in a test without standing up a real paging/notification channel; a fake
 * implementation records calls, a production one pages security/compliance.
 */
export interface SecurityAlertPort {
  raise(alert: SecurityAlert): Promise<void>;
}

export const SECURITY_ALERT_PORT = Symbol("SecurityAlertPort");
