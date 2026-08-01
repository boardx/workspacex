/**
 * F37 -- the ingest idempotency key (uc-22-2 R7, architecture 第七节门槛3):
 *
 *   幂等键 = content_hash + pipeline_version + parser_version
 *
 * A pure value, deliberately not a hash of the three parts: the contract's `IngestionRun`
 * (`packages/contracts/src/artifact.ts`) types `idempotencyKey` as a plain `string`, and
 * every part of the triple is independently useful to a human reading a support ticket
 * ("which parser version produced this"), so concatenation with a delimiter beats hashing
 * three legible facts into one illegible one.
 */

/** Every caller before F37 implicitly ran at "pipeline 1, parser 1" -- see the migration's
 *  header for why the DB defaults agree with these. */
export const CURRENT_PIPELINE_VERSION = "1";
export const CURRENT_PARSER_VERSION = "1";

export interface IdempotencyKeyParts {
  readonly contentHash: string;
  readonly pipelineVersion: string;
  readonly parserVersion: string;
}

/** `content_hash:pipeline_version:parser_version` -- a colon is safe because `contentHash`
 *  is constrained to `^[0-9a-f]{64}$` (0006) and neither version string this feature writes
 *  ever contains one. */
export function idempotencyKey(parts: IdempotencyKeyParts): string {
  return `${parts.contentHash}:${parts.pipelineVersion}:${parts.parserVersion}`;
}
