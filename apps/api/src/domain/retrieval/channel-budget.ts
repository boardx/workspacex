/**
 * Splitting one token budget across the planned channels (registered threshold N-3).
 *
 * ## The number is not available and this file must not invent one
 *
 * `THRESHOLDS.retrievalChannelQuota` is registered `{ known: false }` and `requireValue()`
 * throws on it. The rule, however, is decided, and the registration says so in as many words:
 *
 *   * the per-channel quotas must sum to no more than the total budget, and
 *   * any channel that gets truncated must produce a `budget` omission -- truncation may not
 *     happen silently.
 *
 * Both are asserted here without knowing a single quota value. That split is the entire point
 * of the registry: this project has already had one incident where an implementer filled in a
 * plausible number, it got rendered, screenshotted and quoted, and thereafter behaved like a
 * measured standard. So the provisional allocation below is EQUAL SHARES -- which is what the
 * registration itself authorises as a non-blocking stopgap -- and it is labelled `provisional`
 * in the return value so that no caller can present it as a decided policy without saying so.
 *
 * ## Why `provisional` is a returned field rather than a comment
 *
 * A comment is invisible to the code that renders a budget breakdown to a user. A field is not.
 * When the product gives the numbers, `THRESHOLDS.retrievalChannelQuota` becomes
 * `{ known: true, value, source }`, this function starts returning `provisional: false`, and
 * nothing else has to change -- which is the only version of "fill it in later" that actually
 * gets filled in later.
 */
import { omissionReason as OR, thresholds as TH } from "@repo/contracts";
import type { Omission } from "../context-pack/pack-structure";
import type { RetrievalChannel } from "./channel-plan";

export interface ChannelQuota {
  readonly channel: RetrievalChannel;
  readonly tokens: number;
}

export type ChannelQuotaValue = Partial<Record<RetrievalChannel, number>>;

/**
 * Read the registered threshold at its DECLARED type rather than its current literal one.
 *
 * `THRESHOLDS.retrievalChannelQuota` is `{ known: false, ... }` today, and a `const` bound
 * directly to it is narrowed by control-flow analysis to exactly that -- which makes the
 * `known === true` branch `never` and the code that runs once the product decides impossible
 * to write. A function's declared return type is not narrowed, so the seam stays compilable
 * and typechecked. It also means the day the registry is updated, nothing here changes.
 */
function quotaThreshold(): TH.Threshold<ChannelQuotaValue> {
  return TH.THRESHOLDS.retrievalChannelQuota;
}

export interface QuotaAllocation {
  readonly quotas: readonly ChannelQuota[];
  /** True while `THRESHOLDS.retrievalChannelQuota` is undecided. See the header. */
  readonly provisional: boolean;
  /** Where the numbers came from, or where the decision is owed. Never blank. */
  readonly source: string;
}

/**
 * Allocate `totalBudget` tokens across the planned channels.
 *
 * The invariant `sum(quotas) <= totalBudget` holds by construction AND is checked, because
 * "by construction" stops being true the first time somebody adds a rounding adjustment.
 */
export function allocateChannelQuota(
  totalBudget: number,
  channels: readonly RetrievalChannel[],
): QuotaAllocation {
  if (!Number.isInteger(totalBudget) || totalBudget <= 0) {
    throw new Error(`token budget must be a positive integer, got ${totalBudget}`);
  }
  if (channels.length === 0) return { quotas: [], provisional: false, source: "no channel planned" };

  const t = quotaThreshold();
  if (t.known) {
    const decided = TH.requireValue(t, "retrievalChannelQuota");
    const quotas = channels.map((channel) => ({ channel, tokens: decided[channel] ?? 0 }));
    assertQuotaSumWithinBudget(quotas, totalBudget);
    return { quotas, provisional: false, source: t.source };
  }

  // Equal shares. `floor` rather than a proportional remainder distribution: handing the
  // remainder to one channel would be a preference, and a preference is exactly the thing
  // nobody has decided.
  const each = Math.floor(totalBudget / channels.length);
  const quotas = channels.map((channel) => ({ channel, tokens: each }));
  assertQuotaSumWithinBudget(quotas, totalBudget);
  return {
    quotas,
    provisional: true,
    source: `provisional equal split -- ${t.ref} (owner: ${t.owner})`,
  };
}

export function assertQuotaSumWithinBudget(
  quotas: readonly ChannelQuota[],
  totalBudget: number,
): void {
  const sum = quotas.reduce((n, q) => n + q.tokens, 0);
  if (sum > totalBudget) {
    throw new Error(
      `channel quotas sum to ${sum} but the total token budget is ${totalBudget} -- ` +
        `over-allocating guarantees a truncation that no quota predicted (N-3)`,
    );
  }
}

/** One retrieved document, sized. `tokens` is what it would cost to put in the Pack. */
export interface SizedCandidate {
  readonly segmentId: string;
  readonly channel: RetrievalChannel;
  readonly tokens: number;
  /** A4 manual items are never dropped by budget -- E2 makes that an error, not a discard. */
  readonly manual?: boolean;
}

export interface BudgetOutcome {
  readonly kept: readonly SizedCandidate[];
  /** One per dropped candidate, reason `budget`. Empty iff nothing was truncated. */
  readonly omissions: readonly Omission[];
  /** Manual items that did not fit. Non-empty => the caller must raise BUDGET_EXCEEDS_MANUAL. */
  readonly manualOverflow: readonly SizedCandidate[];
}

/**
 * Fill each channel's quota in the order given, and record every truncation.
 *
 * ⚠ The omission is emitted for EVERY dropped candidate, not once per channel. A single
 * "channel X was truncated" note would satisfy a reading of the rule and defeat I-2: the
 * question a user asks is "why is THIS not here", and it is answerable only per document.
 *
 * Manual items are separated rather than dropped. E2 says a budget that cannot hold the
 * manually pinned items is an error the user must resolve, not something the assembler decides
 * quietly -- so they come back in `manualOverflow` and the caller raises the contract's
 * `BUDGET_EXCEEDS_MANUAL`. Returning them as `budget` omissions would be the silent version.
 */
export function applyChannelBudget(
  candidates: readonly SizedCandidate[],
  allocation: QuotaAllocation,
): BudgetOutcome {
  const remaining = new Map<RetrievalChannel, number>(
    allocation.quotas.map((q) => [q.channel, q.tokens]),
  );
  const kept: SizedCandidate[] = [];
  const omissions: Omission[] = [];
  const manualOverflow: SizedCandidate[] = [];

  for (const c of candidates) {
    const left = remaining.get(c.channel);
    if (left !== undefined && c.tokens <= left) {
      remaining.set(c.channel, left - c.tokens);
      kept.push(c);
      continue;
    }
    if (c.manual === true) {
      manualOverflow.push(c);
      continue;
    }
    omissions.push({
      ref: c.segmentId,
      reason: "budget",
      // Derived from the single source, never restated -- `compliance` written by hand here
      // would be the copy that drifts and lets a compliance discard be folded away (I-3/I-4).
      compliance: OR.isComplianceOmission("budget"),
      explain: OR.omissionExplain("budget"),
    });
  }

  return { kept, omissions, manualOverflow };
}
