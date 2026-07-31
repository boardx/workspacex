/**
 * The tree projection: level 1 = source type, level 2 = agenda segment.
 *
 * Pure. It takes the ALREADY-VISIBLE rows and reshapes them; it makes no permission decision,
 * because a projection that could hide a row would be a second permission mechanism and the
 * one nobody watches is the one that leaks.
 *
 * ## 「未归入环节」 is emitted unconditionally
 *
 * uc-22-1 R3 step 2 and the contract note on `getArtifactTree` both say this node must exist
 * and must not be hideable. The reason is a real failure, not tidiness: a file uploaded from
 * the files page carries no `agendaSegmentId`, so if the node were emitted only when it has
 * children, an upload that failed and an upload that succeeded but was never segmented would
 * look identical on screen -- both being "nothing there".
 *
 * So it is emitted with `count: 0` when empty. Emptiness is information; absence is not.
 *
 * ## 🔴 What this file does NOT do: it does not emit "八类恒显示"
 *
 * `usecases.md` A5·22-1 says eight source nodes are always shown. That sentence is not
 * implementable today and this file will not fake it, because THE EIGHT ARE NOT AGREED:
 *
 *   contract   `artifact.ArtifactSource` (SIGNED, 7): survey conversation interview
 *              prototype-run research-run upload ai-generated
 *   prototype  `apps/web/lib/mock/files.ts` (8): file survey interview workshop research
 *              conversation canvas generated
 *   retrieval  `segment_text.source_type` (0009, 8): file survey interview workshop photo
 *              conversation deep-research ai-generated
 *
 * Three vocabularies, no two equal. That is coherence item XC-03 (「三方不齐」) and contract
 * gap `files.KNOWN_CONTRACT_GAPS.FS1`, both open. Hard-coding any one of them here would be
 * this file casting the ruling -- and it would do so in the least visible place, since every
 * gate would then be green against whichever list it invented.
 *
 * ⇒ Level-1 nodes are derived from the source types PRESENT in the visible set. That is
 *   strictly less than the requirement and it is honest about which part is missing.
 *   `tree-list-metadata.test.ts` pins this so the shortfall cannot be mistaken for done.
 */

/** The level-2 node every project has. ⚠ The prototype calls it `seg-none`; see the report. */
export const UNSEGMENTED_KEY = "__unsegmented__";
export const UNSEGMENTED_LABEL = "未归入环节";

export interface TreeInputRow {
  readonly sourceType: string;
  readonly agendaSegmentId: string | null;
}

export interface TreeNodeOut {
  readonly key: string;
  readonly label: string;
  readonly level: 1 | 2;
  readonly count: number;
}

/**
 * Build the flat tree.
 *
 * ⚠ The contract's `TreeNode` is `{ key, label, level, count }` with NO parent pointer, so a
 * level-2 node cannot be attributed to its level-1 parent in the response. Reported rather
 * than fixed: adding a field to a signed contract is a human decision. The consequence is
 * that segment counts here are per-project, not per-source-type.
 */
export function buildArtifactTree(rows: readonly TreeInputRow[]): TreeNodeOut[] {
  const bySource = new Map<string, number>();
  const bySegment = new Map<string, number>();

  for (const r of rows) {
    bySource.set(r.sourceType, (bySource.get(r.sourceType) ?? 0) + 1);
    const seg = r.agendaSegmentId ?? UNSEGMENTED_KEY;
    bySegment.set(seg, (bySegment.get(seg) ?? 0) + 1);
  }
  // Unconditional, and AFTER the loop so a real count is never overwritten by the default.
  if (!bySegment.has(UNSEGMENTED_KEY)) bySegment.set(UNSEGMENTED_KEY, 0);

  const level1 = [...bySource.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, count]): TreeNodeOut => ({ key, label: key, level: 1, count }));

  const level2 = [...bySegment.entries()]
    // The un-segmented node sorts last rather than alphabetically among ids: it is a
    // catch-all, and burying it between two segment ids is how people stop noticing it.
    .sort(([a], [b]) =>
      a === UNSEGMENTED_KEY ? 1 : b === UNSEGMENTED_KEY ? -1 : a < b ? -1 : 1,
    )
    .map(([key, count]): TreeNodeOut => ({
      key,
      label: key === UNSEGMENTED_KEY ? UNSEGMENTED_LABEL : key,
      level: 2,
      count,
    }));

  return [...level1, ...level2];
}
