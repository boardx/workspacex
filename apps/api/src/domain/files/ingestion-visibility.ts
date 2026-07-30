/**
 * N-7: `originalDownloadable` and `retrievable` are TWO independent booleans.
 *
 * Innermost layer -- no I/O, no HTTP, no PostgreSQL.
 *
 * ## Why two booleans and not one "ready" flag
 *
 * `STORED` means the bytes are in the object store, so the original is downloadable from that
 * moment -- even if extraction, segmentation and indexing never finish. `READY`/`INDEXED`
 * means the content entered retrieval recall. Collapsing them into one flag makes two very
 * different situations look identical:
 *
 *   * "your file is there, the transcript is still coming"           -- normal, wait
 *   * "your file is there and will never be found by the assistant"  -- broken, act
 *
 * `REVIEW_PENDING` is the case that proves the two are not a single ordering: the original IS
 * downloadable and the content is deliberately NOT recallable until a human accepts it
 * (uc-22-2 R3 step 11). Any implementation that derives `retrievable` from "how far along the
 * enum are we" gets this one wrong, which is why both sets are written out.
 *
 * ⚠ The prototype's `INGEST_PIPELINE` table in `apps/web/lib/mock/files.ts` carries the SAME
 * two facts per state. That is a second declaration site, and it is not left as a claim:
 * `apps/web/tests/ui/files-browser.test.tsx` reads THIS file and fails if the two disagree.
 * The right long-term home is the contract (`packages/contracts/src/files.ts`), which today
 * has no schema for it -- reported rather than silently added, because that file is signed.
 */
import { artifact } from "@repo/contracts";
import type { z } from "zod";

export type IngestionStatus = z.infer<typeof artifact.IngestionStatus>;

/** Bytes are in the object store. From here the ORIGINAL is downloadable, forever. */
export const DOWNLOADABLE_STATES: readonly IngestionStatus[] = [
  "STORED", "EXTRACTED", "SEGMENTED", "ENRICHED", "INDEXED", "REVIEW_PENDING", "READY",
];

/**
 * The content is in retrieval recall.
 *
 * ⚠ `REVIEW_PENDING` is absent on purpose (see the header) and `ENRICHED` is absent because
 * embeddings existing is not the same as the FTS/vector rows being live.
 */
export const RETRIEVABLE_STATES: readonly IngestionStatus[] = ["INDEXED", "READY"];

export function originalDownloadable(status: IngestionStatus): boolean {
  return DOWNLOADABLE_STATES.includes(status);
}

export function retrievable(status: IngestionStatus): boolean {
  return RETRIEVABLE_STATES.includes(status);
}
