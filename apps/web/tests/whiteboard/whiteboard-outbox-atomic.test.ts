import { describe, expect, it } from "vitest";
import {
  commitWhiteboardOutboxRebind,
  assertWhiteboardOutboxReauthorization,
  whiteboardOutboxRevokedRows,
  whiteboardOutboxRecoveryView,
  whiteboardOutboxTokenRevoked,
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
  retired: Set<string>;
};

function transaction(state: DurableState, failAt: number | null): WhiteboardOutboxRebindTransaction {
  const stagedRows = new Map(state.rows);
  let stagedJournal = state.journal;
  const stagedRetired = new Set(state.retired);
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
    retireSource() {
      fault();
      if (stagedJournal) stagedRetired.add(stagedJournal.fromHash);
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
        state.retired = stagedRetired;
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

    // put x2, delete x2, source retirement, journal clear, and transaction commit are all faulted.
    for (let failAt = 0; failAt < 7; failAt++) {
      const state: DurableState = {
        rows: new Map(source.map((value) => [value.id, value])),
        journal: preparedJournal,
        retired: new Set(),
      };
      await expect(commitWhiteboardOutboxRebind(source, replacements, transaction(state, failAt))).rejects.toThrow("injected");

      // IndexedDB aborts the whole transaction, so a newly opened instance sees the
      // prepared alias and the intact source generation rather than a mixed generation.
      expect([...state.rows.keys()].sort()).toEqual(["old:a", "old:b"]);
      expect(state.journal).toEqual(preparedJournal);
      expect(state.retired).toEqual(new Set());
      expect(whiteboardOutboxRecoveryView([...state.rows.values()], state.journal, "old")).toEqual({ revoked: true, rows: [] });
      expect(whiteboardOutboxTokenRevoked(state.journal, state.retired.has("old"), "old")).toBe(true);
      expect(whiteboardOutboxRecoveryView([...state.rows.values()], state.journal, "new").rows.map((item) => item.id).sort()).toEqual([
        "old:a",
        "old:b",
      ]);

      // Simulate restore(newToken) in the reopened instance finishing the journal.
      await commitWhiteboardOutboxRebind(source, replacements, transaction(state, null));
      expect(state.journal).toBeNull();
      expect(state.retired).toEqual(new Set(["old"]));
      expect([...state.rows.keys()].sort()).toEqual(["new:a", "new:b"]);
      expect(whiteboardOutboxRecoveryView([...state.rows.values()], state.journal, "new").rows).toHaveLength(2);
      expect(whiteboardOutboxRecoveryView([...state.rows.values()], state.journal, "old").rows).toHaveLength(0);
      // A reopened instance applies this same generation predicate in restore,
      // persist, and acknowledge. The old credential stays rejected after the
      // journal is gone while the new credential restores every update.
      expect(whiteboardOutboxTokenRevoked(state.journal, state.retired.has("old"), "old")).toBe(true);
      expect(whiteboardOutboxTokenRevoked(state.journal, state.retired.has("new"), "new")).toBe(false);
    }
  });

  it("atomically commits replacement rows and removes the durable journal", async () => {
    const source = [row("old:a", "old"), row("old:b", "old")];
    const replacements = [row("new:a", "new"), row("new:b", "new")];
    const state: DurableState = {
      rows: new Map(source.map((value) => [value.id, value])),
      journal: { id: "board", boardId: "board", fromHash: "old", toHash: "new", createdAt: 1 },
      retired: new Set(),
    };
    await commitWhiteboardOutboxRebind(source, replacements, transaction(state, null));
    expect(state.journal).toBeNull();
    expect([...state.rows.keys()].sort()).toEqual(["new:a", "new:b"]);
    expect([...state.rows.values()].every((value) => value.tokenHash === "new")).toBe(true);
    expect(state.retired).toEqual(new Set(["old"]));
  });

  it("keeps the retired generation rejected by restore, persist, and acknowledge after reopen", async () => {
    const source = [row("old:a", "old"), row("old:b", "old")];
    const replacements = [row("new:a", "new"), row("new:b", "new")];
    const state: DurableState = {
      rows: new Map(source.map((value) => [value.id, value])),
      journal: { id: "board", boardId: "board", fromHash: "old", toHash: "new", createdAt: 1 },
      retired: new Set(),
    };

    await commitWhiteboardOutboxRebind(source, replacements, transaction(state, null));

    // Reopen: only durable rows/tombstones remain; the prepared journal is gone.
    expect(state.journal).toBeNull();
    expect(whiteboardOutboxTokenRevoked(state.journal, state.retired.has("old"), "old")).toBe(true);
    expect(whiteboardOutboxTokenRevoked(state.journal, state.retired.has("new"), "new")).toBe(false);
    expect(whiteboardOutboxRecoveryView([...state.rows.values()], state.journal, "old").rows).toEqual([]);
    expect(whiteboardOutboxRecoveryView([...state.rows.values()], state.journal, "new").rows.map((value) => value.id).sort()).toEqual([
      "new:a",
      "new:b",
    ]);
  });
});

describe('fresh authorization generation CAS',()=>{
 it('allows only one competing tab to advance a retired generation',()=>{
  let current='retired';const retired=new Set(['retired']);
  const advance=(expected:string,next:string)=>{assertWhiteboardOutboxReauthorization(current,expected,retired.has(expected),undefined);current=next;};
  advance('retired','fresh-a');expect(()=>advance('retired','fresh-b')).toThrow('OUTBOX_GENERATION_CHANGED');expect(current).toBe('fresh-a');
  expect(whiteboardOutboxTokenRevoked(null,retired.has('retired'),'retired')).toBe(true);
 });
 it('late old-tab revoke selects only its retired rows, never fresh pending',()=>{
  const rows=[row('old','retired'),row('new','fresh')];expect(whiteboardOutboxRevokedRows(rows,'retired').map(value=>value.id)).toEqual(['old']);
 });
 it('cannot authorize a live generation or resurrect an unfinished rebind',()=>{
  expect(()=>assertWhiteboardOutboxReauthorization('live','live',false,undefined)).toThrow();
  expect(()=>assertWhiteboardOutboxReauthorization('old','old',true,{id:'board',boardId:'board',fromHash:'old',toHash:'new',createdAt:1})).toThrow();
  expect(whiteboardOutboxTokenRevoked(null,true,'old')).toBe(true);
 });
});
