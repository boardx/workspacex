/**
 * `continueArtifact` —— UC-3（`usecases.md`）：基于某个明确指定的版本继续修改。
 *
 * I-4 / E2（`domain.md` / `usecases.md`）是本函数唯一的业务分支：`basedOnVersion` 必填
 * （契约层已经保证），服务端必须按这个字段去查那个版本的内容，查不到就
 * `ArtifactVersionNotFoundError`，**绝不**悄悄回退到"当前最新版本"。
 * `artifact-continue-version-context.test.ts` 直接断言：种两个版本、
 * `basedOnVersion` 传旧的那个，`launcher` 收到的必须是旧版本的内容，不是最新版本的。
 *
 * 触发新 run 的具体机制在 `ArtifactRunLauncher` 端口之后——本函数不关心"新 run 怎么
 * 发起"，只保证"发起时带的是哪个版本"这一件事做对（见 `ports.ts` 头注：该端口的生产
 * 实现不在本 feature 范围内）。
 */
import type { artifactsSteering as AS } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { ResolveVisibilityDeps } from "../chat/resolve-visibility";
import { resolveVisibility } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { ArtifactNotFoundError, ArtifactNotVisibleError, ArtifactVersionNotFoundError } from "./errors";
import type { ArtifactRunLauncher, ArtifactStore } from "./ports";

export interface ContinueArtifactDeps extends ResolveVisibilityDeps {
  readonly artifacts: ArtifactStore;
  readonly launcher: ArtifactRunLauncher;
}

export async function continueArtifact(
  deps: ContinueArtifactDeps,
  input: { readonly userId: string; readonly orgId: OrgId } & AS.ContinueArtifactInput,
): Promise<AS.ContinueArtifactOutput> {
  const locator = await deps.artifacts.findLocator(input.orgId, input.artifactId);
  if (locator === null) throw new ArtifactNotFoundError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: locator.projectId,
    threadId: locator.threadId,
  });
  if (outcome.kind !== "allow") throw new ArtifactNotVisibleError();

  // I-4：显式按 `basedOnVersion` 查，不是"读最新版本"。
  const guardedVersion = await deps.artifacts.findVersion(input.orgId, input.artifactId, input.basedOnVersion);
  if (guardedVersion === null) throw new ArtifactVersionNotFoundError();
  const disclosedVersion = discloseDecided(guardedVersion, outcome.base);
  if (!isDisclosed(disclosedVersion)) throw new ArtifactNotVisibleError();

  const { runId } = await deps.launcher.launch(input.orgId, {
    userId: input.userId,
    threadId: locator.threadId,
    artifactId: input.artifactId,
    instruction: input.instruction,
    clientRequestId: input.clientRequestId,
    basedOnVersion: disclosedVersion.payload,
  });

  return { runId, artifactId: input.artifactId };
}
