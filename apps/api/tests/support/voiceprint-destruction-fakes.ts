/**
 * In-memory doubles for the F75 voiceprint-destruction ports (`voiceprint-destruction-ports.ts`).
 *
 * `FakeVoiceprintStore.deleteAll` really removes rows from the map (`Map.delete`), not a
 * `destroyedAt` flag flip — that's the counter-proof shape for I-15/I-13: a fake that instead
 * soft-marked rows would let a "physical delete" test pass on a soft-delete implementation.
 * `FakeSessions` deliberately reads live rows out of the same `FakeVoiceprintStore` instance
 * rather than tracking its own "has embeddings" bit, so a test can prove sweep eligibility
 * really depends on what's currently live, not a snapshot taken at seed time.
 */
import type {
  ChannelAssignmentState,
  DerivedRepresentationRef,
  VoiceprintDestroyReason,
  VoiceprintEmbeddingRecord,
} from "../../src/domain/recording/voiceprint-destruction";
import type {
  ChannelAssignmentInspector,
  DerivedRepresentationStore,
  ProvenanceLog,
  SessionInspector,
  VoiceprintPolicyProvider,
  VoiceprintStore,
} from "../../src/application/recording/voiceprint-destruction-ports";

export class FakeChannelAssignments implements ChannelAssignmentInspector {
  private readonly bySession = new Map<string, readonly ChannelAssignmentState[]>();

  setChannels(sessionId: string, channels: readonly ChannelAssignmentState[]): void {
    this.bySession.set(sessionId, channels);
  }

  async channelsOf(sessionId: string): Promise<readonly ChannelAssignmentState[]> {
    return this.bySession.get(sessionId) ?? [];
  }
}

export class FakeVoiceprintStore implements VoiceprintStore {
  readonly rows = new Map<string, VoiceprintEmbeddingRecord>();
  /** deleteAll 调用历史，供测试断言"确实物理删了这些 id"而不是靠副作用反推。 */
  readonly deletedIds: string[] = [];
  /** 可选注入：让某次删除动作抛错，验证 `DESTROY_PARTIAL_FAILURE` 路径。 */
  failNextDelete = false;

  seed(records: readonly VoiceprintEmbeddingRecord[]): void {
    for (const r of records) this.rows.set(r.embeddingId, r);
  }

  async listBySession(sessionId: string): Promise<readonly VoiceprintEmbeddingRecord[]> {
    return [...this.rows.values()].filter((r) => r.sessionId === sessionId && r.destroyedAt === null);
  }

  async deleteAll(embeddingIds: readonly string[]): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("simulated delete failure");
    }
    for (const id of embeddingIds) {
      this.rows.delete(id); // 物理删除：从 map 里拿掉，不是翻 destroyedAt 标记。
      this.deletedIds.push(id);
    }
  }
}

export class FakeDerivedRepresentations implements DerivedRepresentationStore {
  readonly rows = new Map<string, DerivedRepresentationRef>();
  failNextInvalidate = false;

  addRef(id: string, inputEmbeddingId: string): void {
    this.rows.set(id, { id, inputEmbeddingId, invalidatedAt: null });
  }

  async listReferencing(embeddingIds: readonly string[]): Promise<readonly DerivedRepresentationRef[]> {
    const set = new Set(embeddingIds);
    return [...this.rows.values()].filter((d) => set.has(d.inputEmbeddingId));
  }

  async invalidate(ids: readonly string[], at: string): Promise<void> {
    if (this.failNextInvalidate) {
      this.failNextInvalidate = false;
      throw new Error("simulated cascade failure");
    }
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row !== undefined) this.rows.set(id, { ...row, invalidatedAt: at });
    }
  }
}

export class FakeProvenanceLog implements ProvenanceLog {
  readonly events: {
    sessionId: string;
    reason: VoiceprintDestroyReason;
    actor: string;
    at: string;
    destroyedEmbeddingIds: readonly string[];
  }[] = [];
  private counter = 0;

  async recordVoiceprintDestroyed(event: {
    readonly sessionId: string;
    readonly reason: VoiceprintDestroyReason;
    readonly actor: string;
    readonly at: string;
    readonly destroyedEmbeddingIds: readonly string[];
  }): Promise<string> {
    this.counter += 1;
    const auditEventId = `voiceprint-destroyed-${this.counter}`;
    this.events.push({ ...event });
    return auditEventId;
  }
}

export class FakeSessions implements SessionInspector {
  private readonly ended = new Map<string, string>();

  constructor(private readonly embeddings: FakeVoiceprintStore) {}

  setEnded(sessionId: string, endedAt: string): void {
    this.ended.set(sessionId, endedAt);
  }

  async endedSessionsWithLiveEmbeddings(
    asOf: string,
  ): Promise<readonly { readonly sessionId: string; readonly endedAt: string }[]> {
    void asOf; // 天数门槛是 domain 的 isSweepEligible 的事，这个 port 只报「还有活的向量」。
    const out: { sessionId: string; endedAt: string }[] = [];
    for (const [sessionId, endedAt] of this.ended) {
      const hasLive = [...this.embeddings.rows.values()].some(
        (r) => r.sessionId === sessionId && r.destroyedAt === null,
      );
      if (hasLive) out.push({ sessionId, endedAt });
    }
    return out;
  }
}

export class FakeVoiceprintPolicy implements VoiceprintPolicyProvider {
  private days: number | null = null;

  set(days: number | null): void {
    this.days = days;
  }

  async fallbackDestroyDays(): Promise<number | null> {
    return this.days;
  }
}

export interface VoiceprintDestructionHarness {
  readonly channels: FakeChannelAssignments;
  readonly embeddings: FakeVoiceprintStore;
  readonly derived: FakeDerivedRepresentations;
  readonly provenance: FakeProvenanceLog;
  readonly sessions: FakeSessions;
  readonly policy: FakeVoiceprintPolicy;
}

export function voiceprintDestructionHarness(): VoiceprintDestructionHarness {
  const embeddings = new FakeVoiceprintStore();
  return {
    channels: new FakeChannelAssignments(),
    embeddings,
    derived: new FakeDerivedRepresentations(),
    provenance: new FakeProvenanceLog(),
    sessions: new FakeSessions(embeddings),
    policy: new FakeVoiceprintPolicy(),
  };
}
