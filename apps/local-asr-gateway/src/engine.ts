/**
 * The engine boundary. The gateway (protocol) never sees a model; an engine never sees a
 * socket. Swapping Zipformer for Qwen3-ASR or Whisper is a new file here, not a protocol
 * change -- which is the whole reason the gateway exists (PROP-LOCAL-WORKSPACE-001 R2).
 */
export interface EngineSession {
  /** 16-bit PCM already converted to float32 in [-1, 1] at `sampleRate`. */
  accept(samples: Float32Array): void;
  /**
   * Run decoding on whatever has been accepted and return the current hypothesis for the
   * segment in progress. `stable` is text the engine will not rewrite; `tail` may change.
   */
  decode(): { stable: string; tail: string };
  /** True once the engine's own endpointing says the current segment ended (server_vad). */
  endpointReached(): boolean;
  /** Close the current segment: return its final text and start a fresh one. */
  finalizeSegment(): string;
  close(): void;
}

export interface Engine {
  readonly name: string;
  createSession(sampleRate: number): EngineSession;
  close(): void;
}

/**
 * Deterministic stand-in for tests and for `LOCAL_ASR_ENGINE=fake`: transcribes sample
 * counts, so a protocol test can assert exact frames without a model on disk.
 */
export class FakeEngine implements Engine {
  readonly name = "fake";
  constructor(private readonly opts: { endpointAfterSamples?: number } = {}) {}
  createSession(sampleRate: number): EngineSession {
    let inSegment = 0;
    let total = 0;
    let closed = false;
    const endpointAt = this.opts.endpointAfterSamples ?? Number.POSITIVE_INFINITY;
    return {
      accept(samples) {
        if (closed) return;
        inSegment += samples.length;
        total += samples.length;
      },
      decode() {
        return inSegment === 0 ? { stable: "", tail: "" } : { stable: `heard ${inSegment}`, tail: ` @${sampleRate}` };
      },
      endpointReached() {
        return inSegment >= endpointAt;
      },
      finalizeSegment() {
        const text = inSegment === 0 ? "" : `final ${inSegment} of ${total}`;
        inSegment = 0;
        return text;
      },
      close() {
        closed = true;
      },
    };
  }
  close(): void {
    /* nothing to release */
  }
}

/** Little-endian signed 16-bit PCM → float32. The protocol carries base64 of exactly this. */
export function pcm16leToFloat32(buf: Buffer): Float32Array {
  const n = Math.floor(buf.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}
