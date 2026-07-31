/**
 * F34 -- `renameArtifact` / `resolveArtifactAlias` (uc-22-1 R7, N-23 / V11·22-1).
 *
 * ## The contract this file exists to make true
 *
 * 「目录结构与文件命名一旦对外可见即为契约。改名、改目录层级必须走迁移：保留旧路径的重定向或
 * 别名，并在变更日志中记录；禁止随手重构」. A rename that is a bare `UPDATE title` with
 * nothing else is exactly the thing this rule forbids -- every already-downloaded zip,
 * every reference link and every archived deliverable that names the OLD path breaks the
 * moment that statement commits. `renameAndAlias` (the repository method) makes the alias
 * write and the rename ONE transaction so that state cannot occur.
 *
 * ## Why the alias table stores only the old name, and resolution is single-hop
 *
 * See `0033-f34-files-terminal-states.sql`'s header. In short: `resolveArtifactAlias` always
 * reads the artifact's CURRENT name fresh, rather than following a chain of alias rows, so a
 * chain of renames (A -> B -> C) resolves correctly from ANY old name without this file (or
 * the migration) needing to know how long the chain is.
 *
 * ## Both use cases go through the SAME `wsx_visible_artifacts()` row gate as F31/F32
 *
 * An artifact's current name is content. `findRenamable` / `findByCurrentName` /
 * `findLatestAlias` / `currentName` all return `Guarded<T>`, unwrapped here via
 * `discloseDecided` with a decision this file already computed -- never via `disclose()`,
 * for the same reason `browse-artifacts.ts` gives: the row gate ran in SQL, and re-judging
 * per row in TypeScript would be the second filter that makes "the predicate is missing"
 * undetectable.
 *
 * ## `PROJECT_ROLE_INSUFFICIENT` collapses two authorize() outcomes, on purpose
 *
 * The SIGNED contract's `renameArtifact.err` is exactly `["ARTIFACT_NOT_FOUND",
 * "PROJECT_ROLE_INSUFFICIENT"]` -- there is no `NO_PROJECT_ROLE` in that list, unlike every
 * other write path in this bundle. `authorize()` can return either reason for a denial (no
 * project role at all, or a role that exists but does not include `content.renameFile`).
 * Rather than widening the contract to add a third err code the signed shape does not have,
 * this use case reports BOTH as `PROJECT_ROLE_INSUFFICIENT` -- a judgment call, stated here
 * rather than left to be discovered, and worth revisiting if that omission from the contract
 * turns out to have been an oversight rather than a choice.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { IdFactory } from "../artifact/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { ArtifactRenameRepository } from "./rename-ports";

export type RenameArtifactResult = z.infer<typeof C.operations.renameArtifact.out>;
export type ResolveArtifactAliasResult = z.infer<typeof C.operations.resolveArtifactAlias.out>;

/** One of `files.FilesError`, scoped to what these two use cases actually raise. */
export type RenameReasonCode = "ARTIFACT_NOT_FOUND" | "PROJECT_ROLE_INSUFFICIENT" | "NO_PROJECT_ROLE";

export class RenameArtifactError extends Error {
  constructor(readonly reasonCode: RenameReasonCode) {
    super("rename_artifact_failed");
  }
}

export interface RenameDeps extends AuthorizeDeps {
  readonly aliases: ArtifactRenameRepository;
  readonly idFactory: IdFactory;
}

/** The write action rename is judged against -- see `domain/identity/project-role-matrix.ts`. */
const RENAME_ACTION = "content.renameFile";

export async function renameArtifact(
  deps: RenameDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly artifactId: string; readonly newName: string; readonly reason: string },
): Promise<RenameArtifactResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  const found = await deps.aliases.findRenamable({
    orgId: input.orgId,
    artifactId: input.artifactId,
    requesterTeamId: membership?.teamId ?? null,
  });
  // Not visible, or not there. One answer -- same discipline as F32's `resolveVisible`.
  if (!found) throw new RenameArtifactError("ARTIFACT_NOT_FOUND");

  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: found.projectId ?? undefined,
    object: { kind: "artifact", id: found.artifactId },
    action: RENAME_ACTION,
  });
  // See the file header: both denial reasons collapse to PROJECT_ROLE_INSUFFICIENT, matching
  // the signed contract's `err` list rather than widening it.
  if (!decision.allowed) throw new RenameArtifactError("PROJECT_ROLE_INSUFFICIENT");

  const disclosed = discloseDecided(found.artifact, decision);
  if (!isDisclosed(disclosed)) throw new RenameArtifactError("PROJECT_ROLE_INSUFFICIENT");
  const oldName = disclosed.payload.currentName;

  const aliasId = deps.idFactory.next("fal");
  await deps.aliases.renameAndAlias({
    id: aliasId,
    orgId: input.orgId,
    projectId: found.projectId,
    artifactId: found.artifactId,
    oldName,
    newName: input.newName,
    reason: input.reason,
    changedBy: input.userId,
  });

  return { aliasFrom: oldName, aliasTo: input.newName, changeLogId: aliasId };
}

/** The read action alias resolution is judged against -- same as `browse-artifacts.ts`. */
const RESOLVE_ACTION = "read.allHands";

export async function resolveArtifactAlias(
  deps: RenameDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly projectId: string; readonly path: string },
): Promise<ResolveArtifactAliasResult> {
  const [decision, membership] = await Promise.all([
    authorize(deps, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
      object: { kind: "project", id: input.projectId },
      action: RESOLVE_ACTION,
    }),
    deps.repo.findOrgMembership(input.userId, input.orgId),
  ]);
  // Contract's `err` here IS `NO_PROJECT_ROLE` (unlike renameArtifact) -- matches
  // `browse-artifacts.ts`'s `passRequesterGate` exactly. Collapsed the same way
  // `passRequesterGate` collapses it: an observer HAS a project role but not `read.allHands`
  // (`PROJECT_ROLE_MATRIX.observer` is `["read.published"]` only), so this throws
  // `NO_PROJECT_ROLE` for that case too rather than a code the contract does not declare --
  // which is the SAME T-6/FS3 question F31/F32 already flag as unruled (may an observer see
  // this at all), taking the fail-closed branch until it is.
  if (!decision.allowed) throw new RenameArtifactError("NO_PROJECT_ROLE");
  const requesterTeamId = membership?.teamId ?? null;

  // `path` still current: no alias was ever needed for this lookup.
  const current = await deps.aliases.findByCurrentName({
    orgId: input.orgId, projectId: input.projectId, requesterTeamId, name: input.path,
  });
  if (current) {
    const d = discloseDecided(current, decision);
    if (isDisclosed(d)) return { artifactId: d.payload.artifactId, currentPath: input.path };
  }

  // `path` is a former name: find the artifact it used to belong to, then read its name
  // RIGHT NOW (not the alias row's "new name" -- there is none stored; see the file header).
  const alias = await deps.aliases.findLatestAlias({
    orgId: input.orgId, projectId: input.projectId, requesterTeamId, oldName: input.path,
  });
  if (!alias) throw new RenameArtifactError("ARTIFACT_NOT_FOUND");
  const aliasDisclosed = discloseDecided(alias, decision);
  if (!isDisclosed(aliasDisclosed)) throw new RenameArtifactError("ARTIFACT_NOT_FOUND");

  const nameNow = await deps.aliases.currentName({
    orgId: input.orgId, artifactId: aliasDisclosed.payload.artifactId, requesterTeamId,
  });
  // The artifact the alias points at was deleted (or rescoped out of view) since. Treated the
  // same as "never existed" (N-25's discipline, applied here too even though this operation's
  // err list names no separate visibility code): a resolvable-but-gone alias must not look
  // different from a bad one.
  if (!nameNow) throw new RenameArtifactError("ARTIFACT_NOT_FOUND");
  const nameDisclosed = discloseDecided(nameNow, decision);
  if (!isDisclosed(nameDisclosed)) throw new RenameArtifactError("ARTIFACT_NOT_FOUND");

  return { artifactId: aliasDisclosed.payload.artifactId, currentPath: nameDisclosed.payload.currentName };
}
