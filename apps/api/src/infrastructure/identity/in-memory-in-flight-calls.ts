/**
 * Process-local `InFlightCallRegistry` (D-U5).
 *
 * ## Read this honestly
 *
 * Phase-00 has no agent runtime, so in production nothing calls `begin()` and every count is
 * genuinely zero. That is not the registry pretending; it is what "no calls are running"
 * looks like when no calls can run.
 *
 * What this class delivers today is the whole path being real and asserted in BOTH
 * directions: zero when nothing is registered, N when N are, and the two disable modes
 * differing in an observable way rather than in a comment. When 04-agent arrives it reports
 * into this port instead of inventing a number for a contract field that already exists.
 *
 * Process-local for the same reason `InMemorySessionStore` is: real storage arrives with
 * phase-01, and a fake distributed one now would be a second thing to replace.
 */
import type { DisableMode } from "../../domain/identity/capability-listing";
import type { InFlightCallRegistry } from "../../application/identity/capability-ports";
import type { OrgId } from "../../domain/org-id";

/** What happened to a call that was running when the capability was disabled. */
export type CallOutcome = "running" | "terminated" | "draining";

interface Call {
  readonly key: string;
  outcome: CallOutcome;
}

/** Keyed by org AND capability. A key without the org is a cross-tenant count. */
const keyOf = (orgId: OrgId, capabilityId: string): string => `${orgId}|${capabilityId}`;

export class InMemoryInFlightCalls implements InFlightCallRegistry {
  private readonly calls = new Map<string, Call>();
  /** Capabilities that stopped admitting new calls, either mode. */
  private readonly closed = new Set<string>();

  /** A call starts. Returns false when the capability is no longer admitting (D-U5). */
  begin(orgId: OrgId, capabilityId: string, callId: string): boolean {
    const key = keyOf(orgId, capabilityId);
    if (this.closed.has(key)) return false;
    this.calls.set(callId, { key, outcome: "running" });
    return true;
  }

  /** A call finishes normally. */
  end(callId: string): void {
    this.calls.delete(callId);
  }

  /** Test/diagnostic view: what became of a call that was running at disable time. */
  outcomeOf(callId: string): CallOutcome | null {
    return this.calls.get(callId)?.outcome ?? null;
  }

  async count(orgId: OrgId, capabilityId: string): Promise<number> {
    const key = keyOf(orgId, capabilityId);
    // `running` only. A draining call is still executing but is no longer something a later
    // disable would affect, and counting terminated ones would report the same call twice
    // across two dialogs.
    let n = 0;
    for (const c of this.calls.values()) if (c.key === key && c.outcome === "running") n++;
    return n;
  }

  async applyDisable(orgId: OrgId, capabilityId: string, mode: DisableMode): Promise<number> {
    const key = keyOf(orgId, capabilityId);
    // Both modes stop NEW calls. That is the half they share; if they did not share it,
    // `drain` would mean "keep going forever".
    this.closed.add(key);
    let affected = 0;
    for (const c of this.calls.values()) {
      if (c.key !== key || c.outcome !== "running") continue;
      // The only difference, and it is observable: `interrupt` ends them now (the security
      // incident case), `drain` lets the current round finish (the version retirement case).
      c.outcome = mode === "interrupt" ? "terminated" : "draining";
      affected++;
    }
    return affected;
  }

  async admits(orgId: OrgId, capabilityId: string): Promise<boolean> {
    return !this.closed.has(keyOf(orgId, capabilityId));
  }
}
