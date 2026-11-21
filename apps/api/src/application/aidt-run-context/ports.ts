import type { AidtContextSelector, AidtContextSnapshot, PreparedAidtContext, AidtStoredContextSnapshot, AidtContextApplicationInput, AidtContextApplicationEvent, AidtContextReceipt } from "@repo/contracts/aidt-run-context";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";
import type { TenantSession } from "../ports/database.port";
export type AidtContextActor = { orgId: OrgId; userId: string; projectId: string; threadId: string };
export type AidtContextFocusRun = { runId: string; inputMessageId: string; skillVersionIds: readonly string[]; skillScope?: "general" | "agent_pins" | null };
export interface AidtMessageAcceptancePort {
  prepareIn(session: TenantSession, actor: AidtContextActor, selector: AidtContextSelector, focusRun: AidtContextFocusRun): Promise<PreparedAidtContext & { focusSkillVersionId: string }>;
  persistIn(session: TenantSession, actor: AidtContextActor, input: { runId: string; inputMessageId: string; selectorHash: string; snapshot: AidtContextSnapshot }): Promise<void>;
  revalidateAcceptedIn(session: TenantSession, actor: AidtContextActor, input: { runId: string; selectorHash: string }): Promise<void>;
}
export interface AidtRunContextSnapshotStore {
  readIn(session: TenantSession, orgId: OrgId, runId: string): Promise<Guarded<AidtStoredContextSnapshot> | null>;
  readScopeIn(session: TenantSession, orgId: OrgId, runId: string): Promise<{ projectId: string; threadId: string; requestedBy: string } | null>;
  saveIn(session: TenantSession, value: AidtStoredContextSnapshot): Promise<void>;
  appendIn(session: TenantSession, orgId: OrgId, runId: string, event: AidtContextApplicationInput): Promise<void>;
  eventsIn(session: TenantSession, orgId: OrgId, runId: string): Promise<readonly AidtContextApplicationEvent[]>;
}
export interface AidtRunContextExecutionPort {
  projectCompleted?(orgId: OrgId, runId: string): Promise<void>;
  reconcileEntity?(actor: AidtContextActor, stageId: number, entityId: string): Promise<boolean>;
  resolve(orgId: OrgId, actor: Omit<AidtContextActor, "orgId">, guarded: Guarded<AidtStoredContextSnapshot>): Promise<AidtStoredContextSnapshot>;
  revalidate(orgId: OrgId, actor: Omit<AidtContextActor, "orgId">, snapshot: AidtStoredContextSnapshot): Promise<void>;
  append(orgId: OrgId, runId: string, event: AidtContextApplicationInput): Promise<void>;
}
export interface AidtRunContextReceiptPort { receipt(actor: { orgId: OrgId; userId: string }, runId: string): Promise<AidtContextReceipt>; }
export const AIDT_MESSAGE_ACCEPTANCE = Symbol("AidtMessageAcceptancePort");
export const AIDT_RUN_CONTEXT_STORE = Symbol("AidtRunContextSnapshotStore");
export const AIDT_RUN_CONTEXT_EXECUTION = Symbol("AidtRunContextExecutionPort");
export const AIDT_RUN_CONTEXT_RECEIPT = Symbol("AidtRunContextReceiptPort");
