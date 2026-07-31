/**
 * F69 AC1 — 四路并行录音互不串台，且**三载体共享一套转写能力**。
 *
 * Four assertions, in increasing order of what they would catch:
 *
 *   1. **Carrier completeness** — the table below runs over exactly the contract's
 *      `RecordingSourceType.options`, checked bidirectionally (same shape as
 *      `lint-ui-material`). A fourth carrier added to the contract and forgotten here fails.
 *   2. **Cross-track isolation** — four tracks per carrier, each fed a disjoint vocabulary;
 *      every stored segment's tokens are disjoint from every other track's vocabulary.
 *      Counts are asserted too: a store that silently dropped everything would otherwise pass.
 *   3. **Lockstep** — flip ONE field of the single `TranscriptionPolicy` and assert **all
 *      three carriers move together**. This is the assertion the feature brief asks for:
 *      「改那一套实现，三个载体的行为一起变」.
 *   4. **Bypass is a compile error** — the reverse direction. `__fixtures__/rec-bypass` is a
 *      carrier writing its own segments; `tsc` must reject it. `__fixtures__/rec-good` proves
 *      the gate does not over-fire.
 *
 * ⚠ (3) and (4) are the load-bearing pair. (2) alone is nearly tautological — the fake store
 * partitions by `trackId`, so of course it partitions. It earns its place only because a
 * counter-proof run (recorded on issue #48) showed it goes red when the core is made to leak
 * across tracks.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { recording as C } from "@repo/contracts";

import { CARRIERS, type SourceType } from "../../src/domain/recording/transcription-core";
import { ingestSegment, startRecording } from "../../src/application/recording/capture";
import { harness, maskingPolicy } from "../support/rec-fakes";

const API_DIR = fileURLToPath(new URL("../..", import.meta.url));

/** Four disjoint vocabularies. No word appears in two lists — that is what makes (2) provable. */
const VOCAB: Record<string, readonly string[]> = {
  A: ["阿尔法", "aardvark", "azimuth"],
  B: ["贝塔", "bramble", "bison"],
  C: ["伽马", "cinder", "cobalt"],
  D: ["德尔塔", "dune", "dovetail"],
};
const LANES = ["A", "B", "C", "D"] as const;

function anchorFor(carrier: SourceType, i: number, lane: string) {
  return carrier === "thread"
    ? { startMs: null, endMs: null, messageId: `msg-${lane}-${i}` }
    : { startMs: i * 1_000, endMs: i * 1_000 + 900, messageId: null };
}

/** Start a session on `carrier` with four tracks, one per lane, all mics granted. */
async function fourTrackSession(carrier: SourceType, deps = harness()) {
  const started = await startRecording(deps, {
    sourceType: carrier,
    sourceRefId: `ref-${carrier}`,
    projectId: "prj-1",
    orgId: "org-1",
    trackPlan: LANES.map((lane) => ({ participantId: `p-${lane}`, micState: "granted" as const })),
  });
  if (!started.ok) throw new Error(`startRecording refused: ${started.reason}`);
  const byLane = new Map<string, string>();
  LANES.forEach((lane, idx) => {
    const track = started.tracks[idx];
    if (track === undefined) throw new Error("track plan produced fewer tracks than planned");
    byLane.set(lane, track.trackId);
  });
  return { deps, sessionId: started.sessionId, byLane };
}

describe("F69 · 三载体共享一套转写能力", () => {
  it("the carrier table IS the contract's enum, both directions", () => {
    // Forward: nothing this test exercises is invented locally.
    expect([...CARRIERS].sort()).toEqual([...C.RecordingSourceType.options].sort());
    // Backward: the three carriers named in domain.md §1.5 are all present, by name.
    expect([...CARRIERS].sort()).toEqual(["interview", "thread", "workshop"]);
  });

  it("every carrier reaches the store through the one core (no per-carrier ingest exists)", async () => {
    for (const carrier of CARRIERS) {
      const { deps, sessionId, byLane } = await fourTrackSession(carrier);
      const trackId = byLane.get("A");
      expect(trackId).toBeDefined();
      const r = await ingestSegment(deps, {
        sessionId,
        trackId: trackId as string,
        anchor: anchorFor(carrier, 0, "A"),
        rawText: VOCAB.A?.join(" ") ?? "",
        asrConfidence: 0.9,
        diarization: { channelId: "ch-A", overlap: false },
        draft: false,
      });
      expect(r.ok, `carrier ${carrier} could not ingest`).toBe(true);
      if (!r.ok) continue;
      // `sourceType` travelled from the session through the core onto the stored row: the
      // carrier is data, not a code path.
      expect(r.segment.sourceType).toBe(carrier);
      expect(deps.segments.appended).toHaveLength(1);
    }
  });

  it("AC1 · four parallel tracks do not cross-talk, on any carrier", async () => {
    for (const carrier of CARRIERS) {
      const { deps, sessionId, byLane } = await fourTrackSession(carrier);

      for (const [i, lane] of LANES.entries()) {
        const words = VOCAB[lane] ?? [];
        for (const [j, word] of words.entries()) {
          const r = await ingestSegment(deps, {
            sessionId,
            trackId: byLane.get(lane) as string,
            anchor: anchorFor(carrier, i * 10 + j, lane),
            rawText: word,
            asrConfidence: 0.95,
            diarization: { channelId: `ch-${lane}`, overlap: false },
            draft: false,
          });
          expect(r.ok, `${carrier}/${lane} ingest refused`).toBe(true);
        }
      }

      // Not "the call succeeded" — the stored rows, read back per track.
      for (const lane of LANES) {
        const mine = await deps.segments.ofTrack(byLane.get(lane) as string);
        expect(mine.length, `${carrier}/${lane} stored nothing — a vacuous pass`).toBe(
          (VOCAB[lane] ?? []).length,
        );
        const foreign = LANES.filter((l) => l !== lane).flatMap((l) => VOCAB[l] ?? []);
        for (const seg of mine) {
          for (const word of foreign) {
            expect(
              seg.text.includes(word),
              `${carrier}: track ${lane} carries "${word}" from another track`,
            ).toBe(false);
          }
          expect(seg.trackId).toBe(byLane.get(lane));
        }
      }

      expect(deps.segments.appended).toHaveLength(LANES.length * 3);
    }
  });

  it("LOCKSTEP · changing the one policy changes all three carriers together", async () => {
    // The seam is a single object read by a single core. If any carrier had its own
    // transcriber, one of these three would keep the old behaviour and the set would split.
    async function fingerprint(policy: ReturnType<typeof maskingPolicy>) {
      const out = new Map<SourceType, { low: boolean; text: string }>();
      for (const carrier of CARRIERS) {
        const { deps, sessionId, byLane } = await fourTrackSession(carrier, harness({ policy }));
        const r = await ingestSegment(deps, {
          sessionId,
          trackId: byLane.get("A") as string,
          anchor: anchorFor(carrier, 0, "A"),
          rawText: "手机号 13800002049",
          asrConfidence: 0.42,
          diarization: { channelId: "ch-A", overlap: false },
          draft: false,
        });
        if (!r.ok) throw new Error(`${carrier}: ${r.reason}`);
        out.set(carrier, { low: r.segment.lowConfidence, text: r.segment.text });
      }
      return out;
    }

    const before = await fingerprint(
      maskingPolicy({ isLowConfidence: () => false }),
    );
    const after = await fingerprint(
      maskingPolicy({
        isLowConfidence: () => true,
        transform: (raw) => raw.replace(/\d{11}/g, "138 •••• 2049"),
      }),
    );

    // Every carrier changed, and changed the same way.
    for (const carrier of CARRIERS) {
      expect(before.get(carrier)?.low, `${carrier} before`).toBe(false);
      expect(after.get(carrier)?.low, `${carrier} did NOT follow the policy change`).toBe(true);
      expect(before.get(carrier)?.text).toContain("13800002049");
      expect(after.get(carrier)?.text, `${carrier} kept the old masking`).toBe(
        "手机号 138 •••• 2049",
      );
    }
    // …and no carrier was left behind: the set of changed carriers IS the set of carriers.
    const changed = [...CARRIERS].filter((c) => before.get(c)?.low !== after.get(c)?.low);
    expect([...changed].sort()).toEqual([...CARRIERS].sort());
  });

  it("BYPASS · a carrier that writes its own segments does not compile", () => {
    const bad = tsc(join(API_DIR, "__fixtures__/rec-bypass/tsconfig.json"));
    expect(bad.code, `the bypass fixture COMPILED — the brand is gone:\n${bad.out}`).not.toBe(0);
    expect(bad.out).toContain("thread-carrier-writes-its-own-segments.ts");
    // Name the type, so a future error that happens to be about something else fails loudly.
    expect(bad.out).toContain("TranscribedSegment");
  });

  it("BYPASS · does NOT over-fire: going through the core compiles", () => {
    const good = tsc(join(API_DIR, "__fixtures__/rec-good/tsconfig.json"));
    expect(good.code, `the legal path stopped compiling:\n${good.out}`).toBe(0);
  });

  it("BYPASS · nobody forges the brand with a cast, either", () => {
    // The brand stops object literals; it does not stop `as unknown as TranscribedSegment`.
    // That escape hatch is legal in exactly one place — where the value is minted.
    const offenders = tsFilesUnder(join(API_DIR, "src")).filter(
      (f) =>
        /as\s+(?:unknown\s+as\s+)?TranscribedSegment/.test(readFileSync(f, "utf8")) &&
        !f.endsWith(join("domain", "recording", "transcription-core.ts")),
    );
    expect(offenders, "a module outside the core casts its way to a segment").toEqual([]);
  });
});

function tsc(project: string): { code: number; out: string } {
  try {
    const out = execFileSync("pnpm", ["exec", "tsc", "--noEmit", "-p", project], {
      cwd: API_DIR,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
