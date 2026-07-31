/**
 * `listBackflow` -- the project side's 「已回流的产出与版本」 (uc-0-1 R12 V3 / AC3).
 *
 * ## The four fields are the acceptance criterion
 *
 * V3: every row returns `mode` / `version` / `pinnedBy` / `pinnedAt`, none of them empty.
 * `BackflowEntry` types all four, but a zod schema cannot assert V3 on its own -- it accepts
 * `{ pinnedBy: "", pinnedAt: "" }` happily, every field present, every type right, and the
 * row still fails to answer "who froze this and when". (That is the same distinction F09
 * recorded between the Pack's V2 and V10.) So the emptiness check is a separate assertion in
 * `backflow-list-fields.test.ts`, not something the parse is expected to catch.
 *
 * ## Where the four fields come from differs by mode, and that difference IS the feature
 *
 *   pinned  the frozen `artifact_version` row. It does not move when the source does (I-8).
 *   live    whatever the head is AT READ TIME. It moves, deliberately, and the badge says so.
 *   draft   nothing: draft rows never reach this list, for anybody (I-12).
 *
 * The resolution happens in SQL (one LATERAL per row rather than a second round trip per
 * binding), but the draft exclusion happens HERE, in the application, against the domain
 * predicate. Doing it in the WHERE clause would make "no drafts were listed" and "the query
 * matched nothing" the same observation, and a test written against that passes with the
 * filter deleted.
 */
import { isProjectSideVisible, badgeFor } from "../../domain/artifact/binding-modes";
import type { OrgId } from "../../domain/org-id";
import { authorize } from "../identity/authorize";
import { disclose } from "../security/permission-filter";
import type { BackflowEntryRecord, BackflowRow, BindingDeps } from "./binding-ports";
import { NoProjectRoleError } from "./binding-errors";

/**
 * The action that governs seeing the project's backflow list.
 *
 * `read.published` is the widest read in the signed matrix -- all four project roles hold it,
 * including `observer`, which matches R5 (「观察者：默认只读已发布且已脱敏内容」) and
 * `listBackflow`'s single declared failure, `NO_PROJECT_ROLE`. What keeps drafts away from an
 * observer is I-12, not the action: the draft filter is unconditional.
 */
export const BACKFLOW_READ_ACTION = "read.published";

/**
 * Which of the six R7 propagation paths this read is.
 *
 * `file-browser` and not a seventh id. R10 ③ states that 22-files「就是 artifacts /
 * artifact_versions 的投影」and shares one `acl_bindings` with retrieval; the backflow list is
 * that same projection filtered to one project's bindings. Registering a seventh path is an
 * amendment to the identity bundle's closed enumeration and is a sign-off decision, not an
 * implementation one -- so it is flagged in the F06 report rather than added here. If a
 * reviewer judges the backflow list a distinct surface, the fix is one entry in
 * `PROPAGATION_PATHS`, and this constant is the single place that changes.
 */
export const BACKFLOW_PATH = "file-browser" as const;

export interface ListBackflowInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly agendaSegmentId?: string;
}

export async function listBackflow(
  deps: BindingDeps,
  input: ListBackflowInput,
): Promise<BackflowEntryRecord[]> {
  const { bindings, auth } = deps;
  const { userId, orgId, projectId, agendaSegmentId } = input;

  const decision = await authorize(auth, {
    userId,
    orgId,
    projectId,
    object: { kind: "project", id: projectId },
    action: BACKFLOW_READ_ACTION,
  });
  if (!decision.allowed) {
    throw new NoProjectRoleError(`${userId} cannot see ${projectId}`);
  }

  const guarded = await bindings.listForProject(orgId, projectId, agendaSegmentId);
  const { visible } = await disclose<BackflowRow>(auth, {
    userId,
    orgId,
    projectId,
    action: BACKFLOW_READ_ACTION,
    path: BACKFLOW_PATH,
    items: guarded,
  });

  const entries: BackflowEntryRecord[] = [];
  for (const { payload } of visible) {
    // I-12, applied to every requester alike -- the author of a draft does not see it here
    // either, because this list is the PROJECT side and a draft is by definition not on it.
    if (!isProjectSideVisible(payload.mode)) continue;
    // A live binding whose artifact lost its head is not representable: `version` is
    // `positive()`. Binding refuses to create that state (`NoVersionToBindError`), so this
    // is unreachable today and skipped rather than fabricated -- emitting a `version: 0`
    // row is precisely the invented data V5 forbids.
    if (payload.resolved === null) continue;
    entries.push({
      bindingId: payload.bindingId,
      artifactId: payload.artifactId,
      title: payload.title,
      mode: payload.mode,
      version: payload.resolved.versionNumber,
      pinnedBy: payload.resolved.pinnedBy,
      pinnedAt: payload.resolved.pinnedAt,
      // Derived from `mode`, never computed independently: the contract declares the same
      // fact twice (`mode` and `badge`) and this is where the two are prevented from
      // disagreeing. See `badgeFor`.
      badge: badgeFor(payload.mode),
    });
  }
  // Empty is empty (V5): no placeholder rows, no "sample" entries.
  return entries;
}
