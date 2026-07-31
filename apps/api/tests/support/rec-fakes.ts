/**
 * In-memory doubles for the F69 capture ports.
 *
 * These are fakes, not stubs: `SegmentStore` really keeps segments per track, so the
 * cross-track isolation assertion reads back what was actually written rather than what the
 * use case claims it wrote. Everything undecided (`isLowConfidence` threshold, masking rules)
 * is supplied by the test, which is the point — the production code owns neither.
 */
import type {
  ConsentGate,
  IdGenerator,
  RecordingSessionState,
  RetentionResolver,
  SegmentStore,
  SessionStore,
  TrackState,
  TrackStore,
  TranscribedSegment,
} from "../../src/application/recording/ports";
import type {
  MaskResult,
  PiiFinding,
  TranscriptionPolicy,
} from "../../src/domain/recording/transcription-core";
import type { CaptureDeps } from "../../src/application/recording/capture";

export class FakeSessions implements SessionStore {
  private readonly rows = new Map<string, RecordingSessionState>();
  private readonly live = new Map<string, string>();

  async session(sessionId: string): Promise<RecordingSessionState | undefined> {
    return this.rows.get(sessionId);
  }

  async create(input: {
    sessionId: string;
    projectId: string;
    sourceType: RecordingSessionState["sourceType"];
    sourceRefId: string;
  }): Promise<void> {
    this.rows.set(input.sessionId, {
      sessionId: input.sessionId,
      projectId: input.projectId,
      sourceType: input.sourceType,
      endedAt: null,
      durationMs: 3_600_000,
    });
    this.live.set(input.sourceRefId, input.sessionId);
  }

  async liveSessionFor(sourceRefId: string): Promise<string | undefined> {
    return this.live.get(sourceRefId);
  }

  end(sessionId: string): void {
    const row = this.rows.get(sessionId);
    if (row !== undefined) this.rows.set(sessionId, { ...row, endedAt: "2026-07-31T00:00:00Z" });
  }
}

export class FakeTracks implements TrackStore {
  private readonly rows = new Map<string, TrackState>();

  async track(trackId: string): Promise<TrackState | undefined> {
    return this.rows.get(trackId);
  }

  async tracksOf(sessionId: string): Promise<readonly TrackState[]> {
    return [...this.rows.values()].filter((t) => t.sessionId === sessionId);
  }

  async create(track: TrackState): Promise<void> {
    this.rows.set(track.trackId, track);
  }

  async updateTimeline(trackId: string, timeline: TrackState["timeline"]): Promise<void> {
    const row = this.rows.get(trackId);
    if (row === undefined) throw new Error(`no track ${trackId}`);
    this.rows.set(trackId, { ...row, timeline });
  }
}

export class FakeSegments implements SegmentStore {
  readonly appended: TranscribedSegment[] = [];
  private seq = 0;

  async append(segment: TranscribedSegment): Promise<{ segmentId: string }> {
    this.appended.push(segment);
    this.seq += 1;
    return { segmentId: `seg-${this.seq}` };
  }

  async ofTrack(trackId: string): Promise<readonly TranscribedSegment[]> {
    return this.appended.filter((s) => s.trackId === trackId);
  }
}

export class SequentialIds implements IdGenerator {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }
}

export const allowingConsent: ConsentGate = { async blocksStart() { return false; } };
export const blockingConsent: ConsentGate = { async blocksStart() { return true; } };

export const someRetention: RetentionResolver = {
  async resolve() {
    // A value supplied by the fake, never by the module under test (I-32 / I-33).
    return { resolvedDays: 180, resolvedFrom: "org", resolvedAt: "2026-07-31T00:00:00Z" };
  },
};

export const missingRetention: RetentionResolver = { async resolve() { return undefined; } };

/** Pass-through masking with a caller-supplied finding list. */
export function maskingPolicy(options: {
  isLowConfidence: (c: number) => boolean;
  findings?: readonly PiiFinding[];
  available?: boolean;
  transform?: (raw: string) => string;
}): TranscriptionPolicy {
  return {
    isLowConfidence: options.isLowConfidence,
    mask(raw: string): MaskResult {
      if (options.available === false) return { available: false };
      return {
        available: true,
        text: options.transform === undefined ? raw : options.transform(raw),
        findings: options.findings ?? [],
      };
    },
  };
}

export interface Harness extends CaptureDeps {
  readonly sessions: FakeSessions;
  readonly tracks: FakeTracks;
  readonly segments: FakeSegments;
}

export function harness(overrides: Partial<CaptureDeps> = {}): Harness {
  const base = {
    sessions: new FakeSessions(),
    tracks: new FakeTracks(),
    segments: new FakeSegments(),
    consent: allowingConsent,
    retention: someRetention,
    policy: maskingPolicy({ isLowConfidence: () => false }),
    ids: new SequentialIds(),
  };
  return { ...base, ...overrides } as Harness;
}
