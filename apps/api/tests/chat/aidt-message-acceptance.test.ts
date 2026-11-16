import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptHumanMessage, MessageIdempotencyConflictError } from "../../src/application/chat/message-roundtrip";
import { prepareAidtMessageSelector, type PublishedAgentSnapshot } from "../../src/application/chat/message-command-ports";
import type { AidtContextSnapshot } from "@repo/contracts/aidt-run-context";
import { computeContentHash } from "../../src/domain/artifact/content-hash";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import * as visibility from "../../src/application/chat/resolve-visibility";
import { discloseDecided, guard, isDisclosed } from "../../src/application/security/permission-filter";
import { PgChatMessageCommandRepository } from "../../src/infrastructure/chat/pg-chat-message-command-repository";
import { toOrgId } from "../../src/domain/org-id";

const orgId = toOrgId("aidt-acceptance-org");
const ref = { kind: "project" as const, id: "project" };
const decision = { allowed: true, decisionId: "authorized" } as never;
const selector = { schemaVersion: 1, projectId: "project", purpose: "stage", stageId: 1, stageRevisions: [] };
const snapshot: PublishedAgentSnapshot = {
  agentId: "agent", agentVersionId: "agent-version", skillScope: "general",
  skillVersionIds: ["other", "focus"], modelProvider: "deep-agent", modelId: "model", instructions: "instructions",
};
const input = {
  projectId: "project", threadId: "thread", actorId: "student", clientMessageId: "00000000-0000-4000-8000-000000000001",
  text: "学生原文保持完整", selectedAgentId: "agent", messageId: "message", runId: "run", snapshot,
};
const selectorHash = prepareAidtMessageSelector(selector as never)!.hash;
const frozen: AidtContextSnapshot = {
  schemaVersion: 1, selector: selector as AidtContextSnapshot["selector"],
  focus: { skillId: "skill", skillVersionId: "focus", skillStableName: "aidt-understand", title: "理解与提出问题" },
  sources: [], omissions: [], formatterVersion: 1, modelReferenceBlock: "合成已保存材料",
  modelReferenceBlockHash: computeContentHash(new TextEncoder().encode("合成已保存材料")), truncated: false,
};
const accepted = (hash?: string | null) => ({
  id: "message", threadId: "thread", authorId: "student", text: input.text,
  clientMessageId: input.clientMessageId, requestedAgentId: "agent", createdAt: "2026-11-16T00:00:00.000Z",
  agentRunId: "run", runStatus: "queued" as const, skillScope: "general" as const, aidtSelectorHash: hash,
});
function unwrap<T>(value: Parameters<typeof discloseDecided<T>>[0]): T {
  const result = discloseDecided(value, decision);
  if (!isDisclosed(result)) throw new Error("test disclosure failed");
  return result.payload;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(visibility, "resolveVisibility").mockResolvedValue({
    kind: "allow", actor: { projectRole: "participant" }, thread: { projectId: "project", archived: false }, base: decision,
  } as never);
});

function application(existing: ReturnType<typeof accepted> | null, outcome = "created") {
  const commands = {
    findAccepted: vi.fn(async () => guard(ref, existing)),
    accept: vi.fn(async () => guard(ref, { kind: outcome, accepted: accepted() })),
  };
  const title = vi.fn(async () => null);
  const deps = {
    commands, chat: { findThreadFacts: async () => ({ projectId: "project" }), readThreadTitleState: title },
    publishedAgents: { resolvePublished: async () => snapshot },
    threadMounts: { activeMountedSkillVersionIds: async () => guard(ref, ["focus"]) },
    enabledSkills: { currentEnabledSkillVersionIds: async () => guard(ref, []) },
  } as unknown as Parameters<typeof acceptHumanMessage>[0];
  return { deps, commands, title };
}
const appInput = { orgId, userId: "student", threadId: "thread", clientMessageId: input.clientMessageId, text: input.text, agentId: "agent" };

describe("application selector identity and transaction replay", () => {
  it.each([null, "a".repeat(64)])("rejects adding or changing selector on an accepted key (%s)", async hash => {
    const f = application(accepted(hash));
    await expect(acceptHumanMessage(f.deps, { ...appInput, aidtContext: selector } as never)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_CONFLICT" });
    expect(f.commands.accept).not.toHaveBeenCalled();
  });

  it("rejects dropping the accepted selector", async () => {
    const f = application(accepted("a".repeat(64)));
    await expect(acceptHumanMessage(f.deps, appInput)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_CONFLICT" });
  });

  it("returns reused for a transaction replay after an outer miss, without another AIDT kick or title", async () => {
    const f = application(null, "replay"), kick = vi.fn();
    const result = await acceptHumanMessage(f.deps, { ...appInput, aidtContext: selector, onAccepted: kick } as never);
    expect(result.reused).toBe(true);
    expect(kick).not.toHaveBeenCalled();
    expect(f.title).not.toHaveBeenCalled();
  });

  it("reuses the same AIDT selector without a new wake-up", async () => {
    const f = application(accepted(selectorHash)), kick = vi.fn();
    expect((await acceptHumanMessage(f.deps, { ...appInput, aidtContext: selector, onAccepted: kick } as never)).reused).toBe(true);
    expect(kick).not.toHaveBeenCalled(); expect(f.commands.accept).not.toHaveBeenCalled();
  });

  it("compares canonical revision selections rather than object or reference order", async () => {
    const a = { ...selector, stageId: 2, stageRevisions: [{ stageId: 1, revision: 3 }, { stageId: 2, revision: 1 }] };
    const b = { ...a, stageRevisions: [...a.stageRevisions].reverse() };
    const f = application(accepted(prepareAidtMessageSelector(a as never)!.hash));
    expect((await acceptHumanMessage(f.deps, { ...appInput, aidtContext: b } as never)).reused).toBe(true);
  });

  it("does not accept a new attachment on an old AIDT run", async () => {
    const f = application(accepted(selectorHash));
    await expect(acceptHumanMessage(f.deps, { ...appInput, aidtContext: selector, attachmentIds: ["new-photo"] } as never)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_CONFLICT" });
  });

  it("preserves the ordinary conflict error", async () => {
    const f = application({ ...accepted(), text: "old ordinary words" });
    await expect(acceptHumanMessage(f.deps, appInput)).rejects.toBeInstanceOf(MessageIdempotencyConflictError);
  });

  it.each([{ ...selector, system: "not a selector field" }, null])("rejects invalid selector data before command writes", async raw => {
    const f = application(null);
    await expect(acceptHumanMessage(f.deps, { ...appInput, aidtContext: raw } as never)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_INVALID" });
    expect(f.commands.accept).not.toHaveBeenCalled();
  });

  it("keeps ordinary fresh acceptance and its bounded recovery wake-ups", async () => {
    const f = application(null), kick = vi.fn();
    expect((await acceptHumanMessage(f.deps, { ...appInput, onAccepted: kick })).reused).toBe(false);
    expect(kick).toHaveBeenCalledTimes(2);
    expect(f.commands.accept).toHaveBeenCalledWith(orgId, expect.not.objectContaining({ aidtContext: expect.anything() }));
  });
});

/** Transaction protocol fake: intentionally no database or provider is started.
 * A6's separate real-PG lane verifies the actual SQL constraints and rollback. */
class Transactions implements DatabasePort {
  state = { messages: [] as unknown[][], runs: [] as unknown[][], snapshots: [] as unknown[] };
  existing: Record<string, unknown> | null = null;
  thread = { id: "thread", project_id: "project", archived: false };
  events: string[] = [];
  session?: TenantSession;
  async withTenant<T>(requestedOrg: typeof orgId, fn: (s: TenantSession) => Promise<T>): Promise<T> {
    expect(requestedOrg).toBe(orgId);
    const before = structuredClone(this.state);
    const s: TenantSession = { query: async <R>(sql: string, params: readonly unknown[] = []) => {
      if (sql.includes("FROM chat_messages m JOIN agent_runs")) return { rows: (this.existing ? [this.existing] : []) as R[] };
      if (sql.includes("FROM chat_threads") && sql.includes("FOR UPDATE")) { this.events.push("thread-lock"); return { rows: [this.thread] as R[] }; }
      if (sql.includes("SELECT kind FROM organizations")) return { rows: [{ kind: "personal" }] as R[] };
      if (sql.includes("INSERT INTO chat_messages")) { this.events.push("message"); this.state.messages.push([...params]); return { rows: [{ created_at: new Date("2026-11-16T00:00:00Z") }] as R[] }; }
      if (sql.includes("INSERT INTO agent_runs")) { this.events.push("run"); this.state.runs.push([...params]); }
      return { rows: [] as R[] };
    } };
    this.session = s;
    try { return await fn(s); } catch (error) { this.state = before; throw error; }
  }
  async withoutTenant<T>(): Promise<T> { throw new Error("unexpected global transaction"); }
  async close() {}
}
function stored(hash: string | null) {
  return { id: "message", thread_id: "thread", author_id: "student", body: input.text,
    client_message_id: input.clientMessageId, requested_agent_id: "agent", created_at: new Date(),
    agent_run_id: "run", status: "queued", skill_scope: "general", aidt_selector_hash: hash, attachment_ids: [] };
}
function preparation(db: Transactions) {
  return {
    prepareIn: vi.fn(async (session: TenantSession) => {
      expect(session).toBe(db.session); db.events.push("project/org/member/thread-prepare");
      return { selectorHash, snapshotHash: "b".repeat(64), snapshot: frozen, focusSkillVersionId: "focus" };
    }),
    persistIn: vi.fn(async (session: TenantSession, _actor: unknown, value: unknown) => {
      expect(session).toBe(db.session); db.events.push("snapshot"); db.state.snapshots.push(value);
    }),
    revalidateAcceptedIn: vi.fn(async (session: TenantSession) => { expect(session).toBe(db.session); }),
  };
}
function repository(db: Transactions, port?: ReturnType<typeof preparation>) {
  return new PgChatMessageCommandRepository(db, undefined, port as never);
}

describe("tenant-transaction AIDT acceptance protocol", () => {
  it("prepares before the repository thread lock and writes message/run/frozen material on the same session", async () => {
    const db = new Transactions(), port = preparation(db);
    const out = unwrap(await repository(db, port).accept(orgId, { ...input, aidtContext: selector } as never));
    expect(out.kind).toBe("created");
    expect(db.events).toEqual(["project/org/member/thread-prepare", "thread-lock", "message", "run", "snapshot"]);
    expect(db.state.messages[0]?.[4]).toBe(input.text);
    expect(db.state.runs[0]?.slice(4, 7)).toEqual(["agent", "agent-version", JSON.stringify(["focus"])]);
    expect(db.state.snapshots).toHaveLength(1);
  });

  it("rolls back message and run if snapshot persistence fails", async () => {
    const db = new Transactions(), port = preparation(db);
    port.persistIn.mockImplementation(async () => { throw new Error("snapshot persistence failed"); });
    await expect(repository(db, port).accept(orgId, { ...input, aidtContext: selector } as never)).rejects.toThrow("snapshot persistence failed");
    expect(db.state).toEqual({ messages: [], runs: [], snapshots: [] });
  });

  it("does not write if preparing authorized source versions fails", async () => {
    const db = new Transactions(), port = preparation(db);
    port.prepareIn.mockRejectedValue(new Error("source unavailable"));
    await expect(repository(db, port).accept(orgId, { ...input, aidtContext: selector } as never)).rejects.toThrow("source unavailable");
    expect(db.state).toEqual({ messages: [], runs: [], snapshots: [] });
  });

  it("fails closed before any write if the AIDT dependency is absent", async () => {
    const db = new Transactions();
    await expect(repository(db).accept(orgId, { ...input, aidtContext: selector } as never)).rejects.toThrow();
    expect(db.state.messages).toHaveLength(0);
  });

  it("rejects a prepared focus outside the frozen authorized skill pool", async () => {
    const db = new Transactions(), port = preparation(db);
    port.prepareIn.mockResolvedValue({ selectorHash, snapshotHash: "b".repeat(64), snapshot: frozen, focusSkillVersionId: "unauthorized" });
    await expect(repository(db, port).accept(orgId, { ...input, aidtContext: selector } as never)).rejects.toThrow();
    expect(db.state.messages).toHaveLength(0);
  });

  it("detects thread scope changes after preparation before writing", async () => {
    const db = new Transactions(), port = preparation(db); db.thread.project_id = "other-project";
    await expect(repository(db, port).accept(orgId, { ...input, aidtContext: selector } as never)).rejects.toThrow();
    expect(db.state.messages).toHaveLength(0);
  });

  it("rejects an archived thread even when the optimistic visibility check was older", async () => {
    const db = new Transactions(), port = preparation(db); db.thread.archived = true;
    await expect(repository(db, port).accept(orgId, { ...input, aidtContext: selector } as never)).rejects.toThrow();
    expect(db.state.messages).toHaveLength(0);
  });

  it("rejects null-to-selector in the inner race guard without preparing", async () => {
    const db = new Transactions(), port = preparation(db); db.existing = stored(null);
    await expect(repository(db, port).accept(orgId, { ...input, aidtContext: selector } as never)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_CONFLICT" });
    expect(port.prepareIn).not.toHaveBeenCalled();
  });

  it("revalidates old AIDT permissions on the findAccepted fast path", async () => {
    const db = new Transactions(), port = preparation(db); db.existing = stored("a".repeat(64));
    port.revalidateAcceptedIn.mockRejectedValue(new Error("no longer readable"));
    await expect(repository(db, port).findAccepted(orgId, input)).rejects.toThrow("no longer readable");
    expect(port.prepareIn).not.toHaveBeenCalled();
  });

  it("replays the original run after current authorization without preparing new material", async () => {
    const db = new Transactions(), port = preparation(db); db.existing = stored(selectorHash);
    const result = unwrap(await repository(db, port).accept(orgId, { ...input, aidtContext: selector } as never));
    expect(result.kind).toBe("replay");
    expect(port.revalidateAcceptedIn).toHaveBeenCalledOnce(); expect(port.prepareIn).not.toHaveBeenCalled();
    expect(db.state).toEqual({ messages: [], runs: [], snapshots: [] });
  });

  it("rejects dropping a selector inside the transaction race guard", async () => {
    const db = new Transactions(), port = preparation(db); db.existing = stored(selectorHash);
    await expect(repository(db, port).accept(orgId, input)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_CONFLICT" });
    expect(port.revalidateAcceptedIn).toHaveBeenCalledOnce(); expect(port.prepareIn).not.toHaveBeenCalled();
  });

  it.each([{ text: "changed" }, { selectedAgentId: "other-agent" }, { attachmentIds: ["new-photo"] }])("rejects a changed AIDT payload in the inner guard: %j", async change => {
    const db = new Transactions(), port = preparation(db); db.existing = stored(selectorHash);
    await expect(repository(db, port).accept(orgId, { ...input, ...change, aidtContext: selector } as never)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_CONFLICT" });
    expect(port.prepareIn).not.toHaveBeenCalled(); expect(db.state.runs).toHaveLength(0);
  });

  it("rejects a changed selector in the inner guard", async () => {
    const db = new Transactions(), port = preparation(db); db.existing = stored(selectorHash);
    await expect(repository(db, port).accept(orgId, { ...input, aidtContext: { ...selector, stageId: 2 } } as never)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_CONFLICT" });
    expect(port.prepareIn).not.toHaveBeenCalled();
  });

  it("preserves the ordinary transaction conflict outcome", async () => {
    const db = new Transactions(), port = preparation(db); db.existing = stored(null);
    expect(unwrap(await repository(db, port).accept(orgId, { ...input, text: "changed ordinary words" })).kind).toBe("conflict");
    expect(port.revalidateAcceptedIn).not.toHaveBeenCalled();
  });

  it("rolls back if prepared selector identity does not match the received selector", async () => {
    const db = new Transactions(), port = preparation(db);
    port.prepareIn.mockResolvedValue({ selectorHash: "c".repeat(64), snapshotHash: "b".repeat(64), snapshot: frozen, focusSkillVersionId: "focus" });
    await expect(repository(db, port).accept(orgId, { ...input, aidtContext: selector } as never)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_SNAPSHOT_MISMATCH" });
    expect(db.state.messages).toHaveLength(0);
  });

  it("rejects explicit Agent pins before preparing AIDT material", async () => {
    const db = new Transactions(), port = preparation(db);
    await expect(repository(db, port).accept(orgId, { ...input, snapshot: { ...snapshot, skillScope: "agent_pins" }, aidtContext: selector } as never)).rejects.toThrow();
    expect(port.prepareIn).not.toHaveBeenCalled(); expect(db.state.messages).toHaveLength(0);
  });

  it("does not invoke the AIDT port or change the pins on an ordinary fresh run", async () => {
    const db = new Transactions(), port = preparation(db);
    await repository(db, port).accept(orgId, input);
    expect(port.prepareIn).not.toHaveBeenCalled(); expect(port.persistIn).not.toHaveBeenCalled();
    expect(db.state.runs[0]?.[6]).toBe(JSON.stringify(snapshot.skillVersionIds));
  });
});
