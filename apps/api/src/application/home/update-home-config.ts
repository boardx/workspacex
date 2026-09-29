/**
 * `updateHomeConfig`（ad-hoc feature，Refs #4634）—— 仅组织 admin。
 * 授权（`orgRole !== "admin"`）由 controller 的 `requireOrgAdmin` 挡在前面
 * （同 `updateOrganization` 先例，见 `update-organization.ts`），本用例不重复判一次。
 */
import type { OrgId } from "../../domain/org-id";
import type { HomeConfig, HomeConfigRepository, UpsertHomeConfigInput } from "./home-config-ports";

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
  return deps.repo.upsert(input.orgId, {
    title: input.title,
    tagline: input.tagline,
    bannerHeadline: input.bannerHeadline,
    bannerTagline: input.bannerTagline,
    bannerPreset: input.bannerPreset,
    quickActions: input.quickActions,
    recommendedCapabilities: input.recommendedCapabilities,
    updatedBy: input.updatedBy,
  });
}
