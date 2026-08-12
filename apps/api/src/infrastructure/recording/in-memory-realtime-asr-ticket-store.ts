import type { RealtimeAsrTicket, RealtimeAsrTicketStore } from "../../application/recording/personal-realtime-asr";

export class InMemoryRealtimeAsrTicketStore implements RealtimeAsrTicketStore {
  private readonly tickets = new Map<string, RealtimeAsrTicket & { used: boolean }>();
  constructor(private readonly now: () => number = Date.now) {}
  async issue(input: RealtimeAsrTicket & { ticket: string }): Promise<RealtimeAsrTicket> {
    const value = { ...input, used: false };
    this.tickets.set(input.ticketHash, value);
    return value;
  }
  async consume(input: { ticketHash: string; orgId: import("../../domain/org-id").OrgId; transcriptionId: string; captureId: string }) {
    const found = this.tickets.get(input.ticketHash);
    if (!found || found.orgId !== input.orgId || found.transcriptionId !== input.transcriptionId || found.captureId !== input.captureId)
      return { ok: false as const, reason: "TICKET_INVALID" as const };
    if (found.used) return { ok: false as const, reason: "TICKET_USED" as const };
    if (found.expiresAtMs < this.now()) return { ok: false as const, reason: "TICKET_EXPIRED" as const };
    found.used = true;
    return { ok: true as const, ...found };
  }
}
