/**
 * The six paths permission has to travel along (UC-0.3 R7 / R12 V10, coherence X-1).
 *
 * ## Why this is a closed enumeration and not documentation
 *
 * R7's rule is that a visibility scope on an Artifact must reach everything derived from
 * it -- Segment, embedding, graph node, cache, Context Pack -- because otherwise "you
 * cannot read the original, but the summary launders it out to you" is a working bypass.
 *
 * Three separate contract bundles found this independently (coherence X-1), and the ruling
 * was: one decision function, six consumers. That ruling is only enforceable if the six
 * are NAMED somewhere a program can read. `disclose()` takes a path id from this list, so
 * a seventh path cannot be invented by writing a seventh module -- it has to be added
 * here, in the identity bundle, where the assertion lives.
 *
 * ## Read `status` honestly
 *
 * Five of the six subsystems DO NOT EXIST YET. Saying so in a field is the point: this
 * project's recurring failure is the unstated gap, not the known one. What F02 delivers is
 * the mechanism plus assertions ON the mechanism -- each path's shape is exercised through
 * the real `decide()` in `permission-propagation-six-paths.test.ts`, and
 * `lint-permission-paths.mjs` makes it impossible for the future subsystem to read tenant
 * data around it. What F02 does NOT deliver is a running retrieval engine to point at.
 *
 * This file is intentionally NOT in `packages/contracts`: no propagation path id crosses
 * the wire. If one ever does, it MOVES there -- it does not get copied.
 */

/** Which feature (or phase) builds the real subsystem behind a path. */
export interface PropagationPath {
  readonly id: string;
  /** The wording UC-0.3 R12 V10 uses, so the mapping back to the spec is not a guess. */
  readonly ucTerm: string;
  /**
   * `mechanism-only` -- nothing reads tenant data through this path yet. F02 asserts the
   *                    decision and the structural block; the subsystem is `owner`'s job.
   * `live`           -- code exists today that would leak without the decision.
   */
  readonly status: "mechanism-only" | "live";
  /** Who builds (or built) the subsystem. Written down so "later" has a name. */
  readonly owner: string;
}

/**
 * `as const satisfies` rather than a plain type annotation: the annotation would widen
 * every `id` to `string`, and then `PropagationPathId` is just `string` and a caller can
 * pass anything. This way the six ids form a literal union, so an unregistered path is a
 * COMPILE error -- and `isPropagationPath` still guards the runtime, for ids that arrive
 * as data (a route parameter, a queue message) where the compiler cannot help.
 */
export const PROPAGATION_PATHS = [
  {
    id: "retrieval",
    ucTerm: "检索",
    status: "mechanism-only",
    owner: "F10 (five-way hybrid recall + RRF + rerank)",
  },
  {
    id: "context-pack",
    ucTerm: "Context Pack",
    status: "mechanism-only",
    owner: "F09 (items[]/claims[]/omissions[] structure)",
  },
  {
    id: "embedding-similarity",
    ucTerm: "embedding 相似度",
    status: "mechanism-only",
    owner: "F10 (pgvector recall set, permission-filtered)",
  },
  {
    id: "graph-traversal",
    ucTerm: "图节点遍历",
    status: "mechanism-only",
    // No phase-00 feature owns the graph. Naming the phase rather than inventing a feature
    // id: a made-up owner reads as covered.
    owner: "phase-01 09-kg (knowledge graph); F07 gates what may be written into it",
  },
  {
    id: "file-browser",
    ucTerm: "文件浏览器",
    status: "mechanism-only",
    // R10 point ③: the file browser shares acl_bindings with retrieval. It is not a
    // permission bypass, and it is listed here so it cannot quietly become one.
    owner: "phase-01 22-files (shares acl_bindings with retrieval, R10 ③)",
  },
  {
    id: "cache",
    ucTerm: "缓存命中",
    // The only one that is live today: `AuthorizationCache` exists (F01), so a cached
    // verdict is something that can actually be served to the wrong tenant right now.
    status: "live",
    owner: "F01 (AuthorizationCache); F02 asserts key scoping and switch invalidation",
  },
] as const satisfies readonly PropagationPath[];

export type PropagationPathId = (typeof PROPAGATION_PATHS)[number]["id"];

export function isPropagationPath(id: string): boolean {
  return PROPAGATION_PATHS.some((p) => p.id === id);
}
