/**
 * The content hash of a Context Pack -- what "逐字节相同" (I-5) and "按 contentHash 不可变"
 * (I-7) are measured against.
 *
 * ## Why a canonical serialization and not `JSON.stringify`
 *
 * `JSON.stringify` preserves INSERTION ORDER of object keys. Two assemblies that produced
 * exactly the same pack -- same items, same reasons, same anchors -- hash differently if one
 * built its items with `{ segmentId, content }` and the other with `{ content, segmentId }`.
 * Nothing in the type system distinguishes those two, a refactor of the item builder produces
 * one from the other, and the visible symptom is that every previously pinned pack starts
 * failing its immutability check on the day nothing about the data changed. An audit trail
 * that cries wolf after a refactor gets switched off.
 *
 * So keys are sorted, at every depth. Arrays are NOT sorted: item ORDER is part of the pack
 * (it is the ranked order the model saw), and a hash that ignored it would call two different
 * packs identical.
 *
 * ## Why `pinnedSnapshotId` is excluded from the digest
 *
 * `pinContextPack` writes `pinnedSnapshotId` onto the pack it is pinning. If that field were
 * inside the digest, the act of pinning would change the hash of the thing being pinned, and
 * the `contentHash` returned by `pinContextPack` could never be compared with anything
 * recorded before it. The hash is over WHAT WAS ASSEMBLED; whether it has since been frozen
 * is a fact about the row, not about the evidence.
 *
 * ⚠ That is a real, stated limitation: this digest cannot detect "somebody attached this
 * pack to a different snapshot". That is what `context_packs`' pin trigger (migration 0016)
 * is for -- the pin columns are write-once in the database, which is a stronger guarantee
 * than a hash anyone recomputing could also recompute.
 *
 * ## `undefined` is refused rather than dropped
 *
 * `JSON.stringify` deletes `undefined`-valued keys. `{ endMs: undefined }` and `{}` would
 * therefore hash identically, so an item whose end-time was lost in a mapping bug would be
 * byte-identical to one that never had it. Since `Anchor`'s fields are all optional, that is
 * exactly the field family where the mistake is available, so it is refused loudly.
 */
import { createHash } from "node:crypto";
import type { ContextPack } from "./pack-structure";

/**
 * A stable string for any JSON value: object keys sorted, arrays left alone.
 *
 * Exported because the same discipline is needed for the RECORDED INPUTS of a run, not only
 * for its output -- see `recorded-run.ts`.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new Error(
      "cannot canonicalise `undefined`: JSON.stringify would delete the key, making a lost " +
        "field byte-identical to one that was never set (see this module's header)",
    );
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    // A key that is present with an `undefined` value is the caller's optional-field case
    // (`{ page: undefined }`), which is genuinely "absent" in TypeScript terms. Dropping it
    // here is safe BECAUSE `canonicalJson(undefined)` above refuses the ambiguous position
    // -- an `undefined` inside an array, where absence has no meaning.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** SHA-256 over the canonical form of what was assembled. Lowercase hex, 64 chars. */
export function packContentHash(pack: ContextPack): string {
  return createHash("sha256").update(canonicalJson({ ...pack, pinnedSnapshotId: null })).digest("hex");
}

/**
 * A replay produced something other than what was recorded.
 *
 * Thrown, never returned as a flag. A pack whose replay diverges is not a degraded answer to
 * "what did this conclusion look at" -- it is a WRONG answer with an audit trail's authority
 * behind it, and the caller has no way to tell it from a right one. The two hashes are in the
 * message because the only useful next step is to diff the two packs.
 */
export class ReplayDivergedError extends Error {
  constructor(
    readonly runId: string,
    readonly recorded: string,
    readonly replayed: string,
  ) {
    super(
      `replay of run "${runId}" produced a different pack than the one recorded ` +
        `(recorded ${recorded}, replayed ${replayed}) -- the assembly is not deterministic, ` +
        `so "同 runId 得同 items[]" (I-5) does not hold and this pack must not be shown as an audit record`,
    );
  }
}
