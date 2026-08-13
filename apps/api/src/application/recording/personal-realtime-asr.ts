import type { OrgId } from "../../domain/org-id";

export type TicketFailure = "TICKET_INVALID" | "TICKET_EXPIRED" | "TICKET_USED";
export interface RealtimeAsrTicket {
  readonly ticketHash: string; readonly orgId: OrgId; readonly ownerUserId: string;
  readonly transcriptionId: string; readonly captureId: string; readonly expiresAtMs: number;
}
export interface RealtimeAsrTicketStore {
  issue(ticket: RealtimeAsrTicket & { readonly ticket: string }): Promise<RealtimeAsrTicket>;
  consume(input: { ticketHash: string; orgId: OrgId; transcriptionId: string; captureId: string }): Promise<
    | ({ ok: true } & RealtimeAsrTicket)
    | { ok: false; reason: TicketFailure }
  >;
}
export const REALTIME_ASR_TICKET_STORE = Symbol("REALTIME_ASR_TICKET_STORE");

export interface AsrUsageEvent {
  readonly providerTaskId: string; readonly orgId: OrgId; readonly ownerUserId: string;
  readonly captureId: string; readonly model: string; readonly durationSeconds: number;
}
export interface AsrUsageMeter { record(event: AsrUsageEvent): Promise<boolean>; }
export const ASR_USAGE_METER = Symbol("ASR_USAGE_METER");

export async function persistThenPublishFinal<T>(persist: () => Promise<T>, publish: (stored: T) => void): Promise<T> {
  const stored = await persist();
  publish(stored);
  return stored;
}
