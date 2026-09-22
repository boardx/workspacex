/**
 * sherpa-onnx streaming transducer (Zipformer) behind the `Engine` boundary.
 *
 * Why this engine first: pure onnxruntime with prebuilt binaries for macOS (arm64/x64),
 * Windows and Linux via `sherpa-onnx-node`'s optional deps -- no Python, no GPU required,
 * CPU real-time on a laptop for the bilingual zh-en model (~ tens of MB). It also ships
 * its own endpointing, which is what `turn_detection: server_vad` maps onto.
 *
 * Model directory layout (see scripts/local-bundle/fetch-asr-model.sh):
 *   encoder*.onnx  decoder*.onnx  joiner*.onnx  tokens.txt
 */
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Engine, EngineSession } from "./engine";

const require = createRequire(import.meta.url);

interface OnlineStream {
  acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void;
  inputFinished(): void;
}
interface OnlineRecognizer {
  createStream(): OnlineStream;
  isReady(s: OnlineStream): boolean;
  decode(s: OnlineStream): void;
  isEndpoint(s: OnlineStream): boolean;
  reset(s: OnlineStream): void;
  getResult(s: OnlineStream): { text: string };
}

export interface SherpaEngineOptions {
  readonly modelDir: string;
  readonly numThreads?: number;
  /** Trailing silence (s) that ends a segment even with no text yet / with text. */
  readonly rule1MinTrailingSilence?: number;
  readonly rule2MinTrailingSilence?: number;
  readonly rule3MinUtteranceLength?: number;
}

function pick(dir: string, prefix: string): string {
  const hit = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith(".onnx") && !f.includes("int8"))
    ?? readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith(".onnx"));
  if (!hit) throw new Error(`no ${prefix}*.onnx in ${dir}`);
  return join(dir, hit);
}

export class SherpaEngine implements Engine {
  readonly name = "sherpa-onnx";
  private readonly recognizer: OnlineRecognizer;

  constructor(opts: SherpaEngineOptions) {
    const sherpa = require("sherpa-onnx-node") as { OnlineRecognizer: new (cfg: unknown) => OnlineRecognizer };
    this.recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: pick(opts.modelDir, "encoder"),
          decoder: pick(opts.modelDir, "decoder"),
          joiner: pick(opts.modelDir, "joiner"),
        },
        tokens: join(opts.modelDir, "tokens.txt"),
        numThreads: opts.numThreads ?? 2,
        provider: "cpu",
        debug: 0,
      },
      decodingMethod: "greedy_search",
      enableEndpoint: true,
      rule1MinTrailingSilence: opts.rule1MinTrailingSilence ?? 2.4,
      rule2MinTrailingSilence: opts.rule2MinTrailingSilence ?? 1.2,
      rule3MinUtteranceLength: opts.rule3MinUtteranceLength ?? 20,
    });
  }

  createSession(sampleRate: number): EngineSession {
    const r = this.recognizer;
    let stream = r.createStream();
    let lastText = "";
    return {
      accept(samples) {
        // sherpa resamples internally when sampleRate differs from featConfig.sampleRate
        stream.acceptWaveform({ samples, sampleRate });
      },
      decode() {
        while (r.isReady(stream)) r.decode(stream);
        lastText = r.getResult(stream).text;
        // Greedy transducer output only appends; the last token may still change with more audio.
        const cut = Math.max(0, lastText.length - 2);
        return { stable: lastText.slice(0, cut), tail: lastText.slice(cut) };
      },
      endpointReached() {
        return r.isEndpoint(stream);
      },
      finalizeSegment() {
        while (r.isReady(stream)) r.decode(stream);
        const text = r.getResult(stream).text.trim();
        r.reset(stream);
        lastText = "";
        return text;
      },
      close() {
        stream.inputFinished();
        stream = r.createStream();
      },
    };
  }

  close(): void {
    /* the addon frees native handles with GC */
  }
}
