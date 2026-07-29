/**
 * S3/PG dual canonical -- which store is authoritative for which fact (architecture §6).
 *
 * ## Why this is a data structure and not a paragraph
 *
 * "The original is canonical in object storage, metadata is canonical in PostgreSQL" is the
 * kind of sentence that lives in a design document and is contradicted by the schema six
 * months later. Written down as a table, two things become checkable:
 *
 *   1. `PG_MUST_NOT_HOLD` names the column types that would mean PG had started storing
 *      bytes. `artifact-schema-six-tables.test.ts` reads pg_catalog and asserts no artifact
 *      table has one -- so I-4 is enforced against the real schema, not against intent.
 *
 *   2. `RESTORE_REQUIRES` is the disaster-recovery consequence, in the same place as the
 *      claim it follows from. Neither store can rebuild the other: object storage does not
 *      know which version was pinned or who may read it, and PG cannot reconstruct bytes
 *      from a pointer. So restoring one alone is not a partial recovery -- it is a database
 *      full of pointers to nothing, or a bucket of files nobody can attribute.
 *
 * ⚠ The drill itself is a DEPLOYMENT obligation and cannot be asserted from inside the
 * application. This module states the requirement and names what it covers; it does not
 * claim the drill has been run. `contracts/artifact/domain.md` lists that as a coverage gap
 * and it stays a gap.
 */

/** Where a class of fact is authoritative. */
export type CanonicalStore = "object-storage" | "postgres";

export interface CanonicalFact {
  readonly fact: string;
  readonly canonicalIn: CanonicalStore;
  /** Why the other store cannot answer it. */
  readonly whyNotTheOther: string;
}

export const CANONICAL_FACTS: readonly CanonicalFact[] = [
  {
    fact: "the bytes of an artifact version",
    canonicalIn: "object-storage",
    whyNotTheOther: "PostgreSQL holds a pointer and a hash; it cannot regenerate a lost object from either",
  },
  {
    fact: "the bytes of a derived representation",
    canonicalIn: "object-storage",
    whyNotTheOther: "same as the original -- a derivative is a file, not a column",
  },
  {
    fact: "version lineage: which version is which number, and which superseded which",
    canonicalIn: "postgres",
    whyNotTheOther: "object storage has no notion of an artifact, only of keys",
  },
  {
    fact: "who pinned a version, when, and against which Context Pack",
    canonicalIn: "postgres",
    whyNotTheOther: "object metadata is writable by anyone who can write the object",
  },
  {
    fact: "who may read an artifact or one of its segments",
    canonicalIn: "postgres",
    whyNotTheOther: "acl_bindings under RLS is the only place the two-layer decision is made (F01)",
  },
  {
    fact: "segments and their anchors back to the original",
    canonicalIn: "postgres",
    whyNotTheOther: "a byte range is meaningless without the version identity that PG holds",
  },
  {
    fact: "the integrity claim (SHA-256) about an object",
    canonicalIn: "postgres",
    whyNotTheOther:
      "storing the expected hash beside the bytes it describes means anyone who can rewrite the bytes can rewrite the claim, and the comparison proves nothing",
  },
];

/**
 * Column data types that would mean PostgreSQL had started holding file bodies (I-4).
 *
 * `text` is absent from this list on purpose: text columns are legitimate everywhere (keys,
 * mime types, locators), so listing it would make the check unusable. What it therefore
 * cannot catch is a base64 blob smuggled into a text column -- stated rather than left to be
 * discovered, because a check whose limits are unwritten gets trusted past them.
 */
export const PG_MUST_NOT_HOLD: readonly string[] = ["bytea", "oid", "lo"];

/** Tables whose rows are only meaningful together with the objects they point at. */
export const RESTORE_REQUIRES: readonly string[] = [
  "postgres: artifacts, artifact_versions, segments, anchors, derived_representations",
  "object storage: every key named by artifact_versions.object_storage_key and derived_representations.object_storage_key",
  "the event log: provenance_events, so the recovered state can be explained",
];
