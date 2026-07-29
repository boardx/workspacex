/**
 * Storage ports for content reads. Defined here, implemented by `infrastructure`.
 *
 * The split between `findItemFacts` and `findItemBody` is the point of this file.
 * A single `findItem(): {..., body}` would be more convenient and would put the body in
 * the hands of the caller BEFORE the boundary rule has run -- at which point "did we
 * return it" depends on every path afterwards remembering not to. Fetching the body only
 * once the rule has said yes means a forgotten branch leaks nothing.
 */
import type { ContentItemFacts } from "../../domain/identity/admin-boundary";
import type { Guarded } from "../security/permission-filter";
import type { OrgId } from "../../domain/org-id";

export interface ContentRepository {
  /** Layer, status, owner -- everything the boundary rule needs and nothing more. */
  findItemFacts(orgId: OrgId, itemId: string): Promise<ContentItemFacts | null>;

  /**
   * The body. Call ONLY after `decideContentRead` returned `allow`.
   *
   * Returns null if the item vanished between the two calls, which the caller renders as
   * not-found rather than as an empty body: an empty string is a plausible body.
   */
  findItemBody(orgId: OrgId, itemId: string): Promise<Guarded<string> | null>;

  /**
   * How many personal-layer items this user holds. A COUNT, deliberately -- not a list
   * whose length the caller takes.
   *
   * Invariant I-8 says an admin querying someone's personal layer gets a response with no
   * content field in it. The most reliable way to keep a field out of a response is for
   * the value never to be loaded, so the boundary is drawn here at the storage port rather
   * than at the serializer: there is nothing downstream to accidentally spread into a
   * response body.
   */
  countPersonalItems(orgId: OrgId, userId: string): Promise<number>;
}

export const CONTENT_REPOSITORY = Symbol("ContentRepository");
