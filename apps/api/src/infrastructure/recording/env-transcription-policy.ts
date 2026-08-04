/**
 * issue #465 — where `TranscriptionPolicy`'s two undecided pieces come from at runtime.
 *
 * ## The threshold is a deployment parameter, and it has no default
 *
 * `transcription-core.ts` refuses to contain a confidence number: D-1 (「多低算低」) is queued
 * for a human, and O-13 downgraded the feature on the explicit condition that the
 * implementer not pick one. A composition root is not a loophole in that condition — a
 * constant here is the same constant, one directory further away.
 *
 * The tempting alternative is worse than it looks. Wiring `isLowConfidence: () => false`
 * when nothing is configured reads as "no opinion", but it IS an opinion: it says no segment
 * is ever low-confidence, i.e. a threshold of negative infinity, and it says it silently —
 * `lowConfidence: false` on every segment is indistinguishable from a well-configured system
 * whose ASR is confident. Every downstream gate (`checkCitability`'s 「待校对」 door) then
 * opens for text nobody vouched for.
 *
 * So an unconfigured deployment cannot ingest. `RECORDING_LOW_CONFIDENCE_THRESHOLD` must be
 * set, and until it is, `POST /recording/sessions/:id/segments` fails closed with 503 — the
 * same posture `PrincipalGuard` takes when its resolver is unavailable (reject, never
 * degrade to allowing). The refusal is loud and it names the missing parameter, which is the
 * difference between a gap and a silent wrong answer.
 *
 * ## Masking is the in-process kernel, for now
 *
 * X-3 puts the real masking kernel in 17-gov, which does not exist in this repository yet;
 * `domain/recording/pii-mask.ts` plays that role today and says so in its own header. It is
 * a pure function that cannot be "unavailable", so `available: false` is unreachable through
 * this implementation — the branch stays in the port because the day masking becomes a
 * remote call, `PII_MASKING_UNAVAILABLE` is the answer, and I-21 says nothing is persisted
 * in that case. Nothing here may quietly store unmasked text instead.
 */
import {
  TranscriptionPolicyUnconfiguredError,
  type TranscriptionPolicyProvider,
} from "../../application/recording/session-lifecycle-ports";
import { maskPii } from "../../domain/recording/pii-mask";
import type { MaskResult, TranscriptionPolicy } from "../../domain/recording/transcription-core";

export const LOW_CONFIDENCE_THRESHOLD_ENV = "RECORDING_LOW_CONFIDENCE_THRESHOLD";

export class EnvTranscriptionPolicyProvider implements TranscriptionPolicyProvider {
  policy(): TranscriptionPolicy {
    const raw = process.env[LOW_CONFIDENCE_THRESHOLD_ENV];
    if (raw === undefined || raw.trim() === "") {
      throw new TranscriptionPolicyUnconfiguredError(
        `${LOW_CONFIDENCE_THRESHOLD_ENV} is not set: the low-confidence threshold is a ` +
          "deployment parameter (D-1 is undecided) and this bundle must not choose one",
      );
    }
    const threshold = Number(raw);
    if (!Number.isFinite(threshold)) {
      // A malformed value is not a missing one, but the safe answer is identical: refuse.
      // Coercing `"abc"` to NaN and comparing would make every segment confident.
      throw new TranscriptionPolicyUnconfiguredError(
        `${LOW_CONFIDENCE_THRESHOLD_ENV} is not a number`,
      );
    }
    return {
      isLowConfidence(asrConfidence: number): boolean {
        return asrConfidence < threshold;
      },
      mask(rawText: string): MaskResult {
        const outcome = maskPii(rawText);
        return { available: true, text: outcome.text, findings: outcome.findings };
      },
    };
  }
}
