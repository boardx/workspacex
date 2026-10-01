/**
 * `updateHomeConfig`（ad-hoc feature，Refs #4634）—— 仅组织 admin。
 * 授权（`orgRole !== "admin"`）由 controller 的 `requireOrgAdmin` 挡在前面
 * （同 `updateOrganization` 先例，见 `update-organization.ts`），本用例不重复判一次。
 */
import type { OrgId } from "../../domain/org-id";
import { HomeConfigDomainError } from "./home-config-errors";
import {
  BannerArtifactNotOwnedError,
  type HomeConfig,
  type HomeConfigRepository,
  type UpsertHomeConfigInput,
} from "./home-config-ports";

export interface UpdateHomeConfigDeps {
  readonly repo: HomeConfigRepository;
}

export interface UpdateHomeConfigUseCaseInput extends UpsertHomeConfigInput {
  readonly orgId: OrgId;
}

export async function updateHomeConfig(
  deps: UpdateHomeConfigDeps,
  input: UpdateHomeConfigUseCaseInput,
): Promise<HomeConfig> {
  // 选了「自定义」却没给颜色：拒绝，而不是悄悄回落到某个预设（用户会以为自定义色生效了）。
  if (input.bannerPreset === "custom" && input.bannerColor === null) {
    throw new HomeConfigDomainError("BANNER_COLOR_REQUIRED");
  }
  try {
    return await persist(deps, input);
  } catch (e) {
    if (e instanceof BannerArtifactNotOwnedError) throw new HomeConfigDomainError("BANNER_ARTIFACT_NOT_OWNED");
    throw e;
  }
}

function persist(deps: UpdateHomeConfigDeps, input: UpdateHomeConfigUseCaseInput): Promise<HomeConfig> {
  return deps.repo.upsert(input.orgId, {
    themeColors: input.themeColors,
    title: input.title,
    tagline: input.tagline,
    bannerHeadline: input.bannerHeadline,
    bannerTagline: input.bannerTagline,
    bannerPreset: input.bannerPreset,
    // 非自定义预设时不留旧的自定义色，避免「切回预设后库里还挂着一个不生效的色值」。
    bannerColor: input.bannerPreset === "custom" ? input.bannerColor : null,
    bannerImageArtifactId: input.bannerImageArtifactId,
    quickActions: input.quickActions,
    recommendedCapabilities: input.recommendedCapabilities,
    recommendedAgents: input.recommendedAgents,
    sections: input.sections,
    updatedBy: input.updatedBy,
  });
}
