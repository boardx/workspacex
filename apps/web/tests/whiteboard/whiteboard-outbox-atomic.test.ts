import { describe, expect, it } from "vitest";
import {
  commitWhiteboardOutboxRebind,
  whiteboardOutboxRecoveryView,
  type CipherRow,
  type WhiteboardOutboxRebindJournal,
  type WhiteboardOutboxRebindTransaction,
} from "@/lib/whiteboard-outbox";

const row = (id: string, tokenHash: string): CipherRow => ({
  id,
  boardId: "board",
  tokenHash,
  iv: new ArrayBuffer(12),
  ciphertext: new ArrayBuffer(1),
  byteSize: 1,
  createdAt: 1,
});

type DurableState = {
  rows: Map<string, CipherRow>;
  journal: WhiteboardOutboxRebindJournal | null;
};

function transaction(state: DurableState, failAt: number | null): WhiteboardOutboxRebindTransaction {
  const stagedRows = new Map(state.rows);
  let stagedJournal = state.journal;
  let boundary = 0;
  let aborted = false;
  const fault = () => {
    if (failAt === boundary++) throw new Error("injected");
  };
  return {
    put(value) {
      fault();
      stagedRows.set(value.id, value);
    },
    delete(id) {
      fault();
      stagedRows.delete(id);
    },
    clearJournal() {
      fault();
      stagedJournal = null;
    },
    abort() {
      aborted = true;
    },
    done: Promise.resolve().then(() => {
      fault();
      if (!aborted) {
        state.rows = stagedRows;
        state.journal = stagedJournal;
      }
    }),
  };
}

describe("encrypted outbox authentication rebind", () => {
  it("recovers with only the refreshed token after reopen at every prepared-journal crash boundary", async () => {
    const source = [row("old:a", "old"), row("old:b", "old")];
    const replacements = [row("new:a", "new"), row("new:b", "new")];
    const preparedJournal: WhiteboardOutboxRebindJournal = {
      id: "board",
      boardId: "board",
      fromHash: "old",
      toHash: "new",
      createdAt: 1,
    };

    // put x2, delete x2, journal clear, and transaction commit are all faulted.
    for (let failAt = 0; failAt < 6; failAt++) {
      const state: DurableState = {
        rows: new Map(source.map((value) => [value.id, value])),
        journal: preparedJournal,
      };
      await expect(commitWhiteboardOutboxRebind(source, replacements, transaction(state, failAt))).rejects.toThrow("injected");

      // IndexedDB aborts the whole transaction, so a newly opened instance sees the
      // prepared alias and the intact source generation rather than a mixed generation.
      expect([...state.rows.keys()].sort()).toEqual(["old:a", "old:b"]);
      expect(state.journal).toEqual(preparedJournal);
      expect(whiteboardOutboxRecoveryView([...state.rows.values()], state.journal, "old")).toEqual({ revoked: true, rows: [] });
      expect(whiteboardOutboxRecoveryView([...state.rows.values()], state.journal, "new").rows.map((item) => item.id).sort()).toEqual([
        "old:a",
        "old:b",
      ]);

      // Simulate restore(newToken) in the reopened instance finishing the journal.
      await commitWhiteboardOutboxRebind(source, replacements, transaction(state, null));
      expect(state.journal).toBeNull();
      expect([...state.rows.keys()].sort()).toEqual(["new:a", "new:b"]);
      expect(whiteboardOutboxRecoveryView([...state.rows.values()], state.journal, "new").rows).toHaveLength(2);
      expect(whiteboardOutboxRecoveryView([...state.rows.values()], state.journal, "old").rows).toHaveLength(0);
    }
  });

  it("atomically commits replacement rows and removes the durable journal", async () => {
    const source = [row("old:a", "old"), row("old:b", "old")];
    const replacements = [row("new:a", "new"), row("new:b", "new")];
    const state: DurableState = {
      rows: new Map(source.map((value) => [value.id, value])),
      journal: { id: "board", boardId: "board", fromHash: "old", toHash: "new", createdAt: 1 },
    };
    await commitWhiteboardOutboxRebind(source, replacements, transaction(state, null));
    expect(state.journal).toBeNull();
    expect([...state.rows.keys()].sort()).toEqual(["new:a", "new:b"]);
    expect([...state.rows.values()].every((value) => value.tokenHash === "new")).toBe(true);
  });
});
