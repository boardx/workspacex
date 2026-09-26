/**
 * getEgressLedger (backlog E4) -- the measured source behind 「本次启动出网 N 次」.
 *
 * The contract (`identity.operations.getEgressLedger`, shape in `@repo/contracts/deployment`)
 * says it is served in the `local` edition only. That is enforced HERE, not in the controller:
 * in a cloud deployment the ledger holds the server's own outbound destinations (database
 * host, model gateway), and no logged-in user has any business reading them.
 */
import type { EgressLedgerValue } from "@repo/contracts/deployment";
import type { EgressLedgerReader } from "./local-org-ports";

export class EgressLedgerNotServedError extends Error {
  constructor() {
    super("the egress ledger is only served in the local edition");
    this.name = "EgressLedgerNotServedError";
  }
}

export function getEgressLedger(reader: EgressLedgerReader): EgressLedgerValue {
  if (reader.edition() !== "local") throw new EgressLedgerNotServedError();
  const s = reader.snapshot();
  return {
    edition: "local",
    since: s.since,
    counts: { ...s.counts },
    recent: s.recent.map((r) => ({ kind: r.kind, target: r.target, at: r.at })),
  };
}
