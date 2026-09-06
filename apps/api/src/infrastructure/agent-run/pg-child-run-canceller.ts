import type { DatabasePort } from "../../application/ports/database.port";
import type { ChildRunCanceller, ParentCancellation } from "../../application/agent-run/parent-run-control";
import { PgSubtaskRunStore } from "./pg-subtask-run-store";
/** Reuses the derived queue's tenant transactions; owns no parent lifecycle state. */
export class PgChildRunCanceller implements ChildRunCanceller {
  private readonly store: PgSubtaskRunStore;
  constructor(db: DatabasePort) { this.store = new PgSubtaskRunStore(db); }
  cancelChildren(input: ParentCancellation) { return this.store.cancelChildren(input); }
  readCancellation(input: ParentCancellation) { return this.store.readCancellation(input); }
}
