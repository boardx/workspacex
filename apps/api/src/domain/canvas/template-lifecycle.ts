/**
 * Template publish lifecycle — the three-stage flow (draft → trial → published) plus
 * archive/restore (O-10), phase-01 F101.
 *
 * Pure: no clock, no I/O, no storage. Given a state and an action the result is a total
 * function of the two, which is what makes the 4-state × 4-action matrix exhaustively
 * testable as a table rather than sampled through a handful of happy-path calls.
 *
 * ## What this file does NOT decide
 *
 * `packages/contracts/src/canvas.ts` keeps `TEMPLATE_NOT_TRIALED` in `publishTemplate`'s
 * error union but marks it `[待定 D-b]` — the prototype archive never confirmed whether
 * "cannot publish without trialing first" is a real gate. F101's notes are explicit that
 * this feature does not add that block, so `draft → published` is a legal transition here
 * without visiting `trial` first. If D-b is later decided "yes", the gate is added as a
 * precondition check in the application layer (which has request context to know whether
 * a trial happened) — it does not change this table, which only knows about states.
 */
import { canvas as C } from "@repo/contracts";
import type { z } from "zod";

export type TemplateStatus = z.infer<typeof C.TemplateStatus>;

export type LifecycleAction = "trial" | "publish" | "archive" | "restore";

/**
 * A template version's lifecycle state. `archivedFrom` only exists while `status ===
 * "archived"` — it is what `restore` needs to answer `restoreTemplate`'s contract, which
 * returns `"draft" | "published"` and nothing else (a template that was archived straight
 * out of `trial` restores to `draft`: `trial` is not a valid restore destination in the
 * contract, and there is no third option to invent one for).
 */
export interface TemplateVersionState {
  readonly status: TemplateStatus;
  readonly archivedFrom?: "draft" | "trial" | "published";
}

export type TransitionResult =
  | { readonly ok: true; readonly next: TemplateVersionState }
  | { readonly ok: false; readonly reason: string };

function assertNever(x: never): never {
  throw new Error(`unhandled template status: ${JSON.stringify(x)}`);
}

/**
 * The full transition table, one case per current status. Exhaustive over `TemplateStatus`
 * by construction: adding a fifth status to the contract makes the `switch` below fail to
 * compile (no `default` branch), not silently fall through to "not allowed".
 */
export function transition(state: TemplateVersionState, action: LifecycleAction): TransitionResult {
  switch (state.status) {
    case "draft":
      if (action === "trial") return { ok: true, next: { status: "trial" } };
      if (action === "publish") return { ok: true, next: { status: "published" } };
      if (action === "archive") return { ok: true, next: { status: "archived", archivedFrom: "draft" } };
      return { ok: false, reason: `draft 状态不接受动作 "${action}"` };

    case "trial":
      if (action === "publish") return { ok: true, next: { status: "published" } };
      if (action === "archive") return { ok: true, next: { status: "archived", archivedFrom: "trial" } };
      return { ok: false, reason: `trial 状态不接受动作 "${action}"` };

    case "published":
      if (action === "archive") return { ok: true, next: { status: "archived", archivedFrom: "published" } };
      return { ok: false, reason: `published 状态不接受动作 "${action}"` };

    case "archived": {
      if (action === "restore") {
        // O-10: restoring what was archived out of "published" gives back "published";
        // anything else (archived straight from draft, or from trial) gives back "draft" —
        // the contract has no third destination to send a former "trial" back to.
        const next: TemplateStatus = state.archivedFrom === "published" ? "published" : "draft";
        return { ok: true, next: { status: next } };
      }
      return { ok: false, reason: `archived 状态不接受动作 "${action}"` };
    }

    default:
      return assertNever(state.status);
  }
}

/** One row of a template's version registry, as `publishNewVersion` sees it. */
export interface TemplateVersionRecord {
  readonly key: string;
  readonly version: number;
  readonly status: TemplateStatus;
}

/**
 * `publishTemplate`'s "旧版自动归档" half of I-4: publishing `newVersion` of `key` archives
 * every OTHER currently-published version of that same key. It does not touch rows of a
 * different `key`, and it does not touch already-archived versions (archiving an archived
 * version a second time is not this function's job — `archiveTemplate` handles that path
 * and it is idempotent there, not here).
 *
 * ⚠ This function only updates the REGISTRY. It says nothing about instances that were
 * already built from the old version — that half of I-4 ("已建实例不被改动") is a property
 * of instances never reading the registry after creation, which is what
 * `instance-version-freeze.ts` is for. A registry update that could reach backward into
 * existing instances would violate I-4 by construction; keeping the two files separate is
 * how "the registry cannot even see instances" stays true rather than merely assumed.
 */
export function publishNewVersion(
  registry: readonly TemplateVersionRecord[],
  key: string,
  newVersion: number,
): { readonly updated: readonly TemplateVersionRecord[]; readonly archived: readonly TemplateVersionRecord[] } {
  const archived: TemplateVersionRecord[] = [];
  let sawNewVersion = false;

  const updated = registry.map((row): TemplateVersionRecord => {
    if (row.key !== key) return row;
    if (row.version === newVersion) {
      sawNewVersion = true;
      return { ...row, status: "published" };
    }
    if (row.status === "published") {
      const archivedRow: TemplateVersionRecord = { ...row, status: "archived" };
      archived.push(archivedRow);
      return archivedRow;
    }
    return row;
  });

  if (!sawNewVersion) {
    updated.push({ key, version: newVersion, status: "published" });
  }

  return { updated, archived };
}

/**
 * I-5 / O-10, the binding half: archived templates must disappear from the binding
 * selector (no NEW binding), independent of whatever `instantiateForSegment` does with
 * bindings that already exist. `listTemplates(forBinding: true)` filters on this — see the
 * contract note that binding selector and admin list share one endpoint precisely so this
 * predicate is asserted once.
 */
export function canCreateNewBinding(status: TemplateStatus): boolean {
  return status === "published";
}

/**
 * I-5 / O-10, the instantiation half, and the one the whole feature exists to protect:
 * a binding that already exists must instantiate successfully no matter what the bound
 * template's CURRENT status is. This is deliberately not a `switch` over `TemplateStatus`
 * that happens to return `true` in every branch — it is a named function whose entire body
 * is the invariant, so "archiving a template must never touch this" reads as a single
 * fact instead of four branches someone could edit independently and get wrong in one.
 *
 * ⚠ If this ever needs a `false` branch, that is O-10 being violated, not a bug in this
 * function needing a new case.
 */
export function canInstantiateExistingBinding(_status: TemplateStatus): true {
  return true;
}

/**
 * `archiveTemplate`'s `confirmed: false` precheck: report the impact without writing
 * anything. `stillBoundSegmentCount` is part of the contract, not a UI nicety — the
 * confirmation dialog is required to show it, and "returns 0" and "doesn't return it" are
 * different responses (a template with no bindings left vs. one nobody counted).
 */
export function previewArchiveImpact(boundAgendaSegmentIds: readonly string[]): {
  readonly stillBoundSegmentCount: number;
} {
  return { stillBoundSegmentCount: boundAgendaSegmentIds.length };
}
