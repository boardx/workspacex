/**
 * `getArtifact` / `listArtifactVersions` —— UC-1 / UC-2（`usecases.md`）。
 *
 * 可见性委托给 `chat` 束既有的 `resolveVisibility`（coverage.md「跨束委托」第一条：
 * "Artifact/run 可见性判定 → 上游 chat/identity 束"），不新造第二套判定——同
 * `agent-run/read-run.ts` 的先例，包括它的 `discloseDecided`/`Guarded<T>` 用法：
 * `PgArtifactStore` 把内容包成 `Guarded<T>`（UC-0.3 R7），这里用 `resolveVisibility`
 * 算出的同一个 `outcome.base` 把它拆开，而不是另起一次判定。
 *
 * 与 `read-run.ts` 不同的一点：`ArtifactError` 契约里 `NOT_VISIBLE` 与
 * `ARTIFACT_NOT_FOUND` 是两个分开的错误码（已签核的
 * `packages/contracts/src/artifacts-steering.ts`），所以这里不像 `read-run.ts` 那样把
 * 两者收成一个退出口——按契约字面区分，折叠成对外单一 404 是 `interface` 层
 * （未来接线时）的事。
 */
import type { artifactsSteering as AS } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { resolveVisibility } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { ArtifactNotFoundError, ArtifactNotVisibleError } from "./errors";
import type { ArtifactStore } from "./ports";

export interface ArtifactReadDeps extends ResolveVisibilityDeps {
  readonly artifacts: ArtifactStore;
}

export async function getArtifact(
  deps: ArtifactReadDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly artifactId: string },
): Promise<AS.ArtifactRecord> {
  const locator = await deps.artifacts.findLocator(input.orgId, input.artifactId);
  if (locator === null) throw new ArtifactNotFoundError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId, orgId: input.orgId, projectId: locator.projectId, threadId: locator.threadId,
  });
  if (outcome.kind !== "allow") throw new ArtifactNotVisibleError();

  const guarded = await deps.artifacts.getArtifact(input.orgId, input.artifactId);
  if (guarded === null) throw new ArtifactNotFoundError();
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new ArtifactNotVisibleError();
  return disclosed.payload;
}

export async function listArtifactVersions(
  deps: ArtifactReadDeps,
  input: { readonly userId: string; readonly orgId: OrgId } & AS.ListArtifactVersionsInput,
): Promise<AS.ListArtifactVersionsOutput> {
  const locator = await deps.artifacts.findLocator(input.orgId, input.artifactId);
  if (locator === null) throw new ArtifactNotFoundError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId, orgId: input.orgId, projectId: locator.projectId, threadId: locator.threadId,
  });
  if (outcome.kind !== "allow") throw new ArtifactNotVisibleError();

  const guarded = await deps.artifacts.listVersions(input.orgId, input);
  const disclosed = discloseDecided(guarded, outcome.base);
  if (!isDisclosed(disclosed)) throw new ArtifactNotVisibleError();
  return disclosed.payload;
}
