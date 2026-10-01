import type { ThemeColors } from "@/lib/home-theme";
import { homeConfig } from "@repo/contracts";
import { isValidBannerColor, QUICK_ACTION_ORDER } from "@/lib/home-config-catalog";
import type {
  BannerPreset, HomeConfig, HomeSections, QuickActionKey, RecommendedAgent, RecommendedCapability, UpdateHomeConfigIn,
} from "@/lib/live-home-config";

/** 后台表单的本地状态。`bannerColorInput` 是输入框里的原始文本（可能还不合法）。 */
export interface HomeConfigFormState {
  themeColors: ThemeColors;
  title: string;
  tagline: string;
  bannerHeadline: string;
  bannerTagline: string;
  bannerPreset: BannerPreset;
  bannerColorInput: string;
  bannerImageArtifactId: string | null;
  /** 当前横幅图 URL（已保存的，或刚上传还没保存的）；仅用于预览。 */
  bannerImageUrl: string | null;
  quickActionEnabled: Record<QuickActionKey, boolean>;
  sections: HomeSections;
  recommendedCapabilities: RecommendedCapability[];
  recommendedAgents: RecommendedAgent[];
}

/** 配置里的图片 URL 形如 `/organizations/:orgId/home-banner-file/:id`；id 是最后一段。 */
export function bannerArtifactIdFromUrl(url: string | null): string | null {
  if (url === null) return null;
  const last = url.split("/").pop();
  return last !== undefined && last.length > 0 ? decodeURIComponent(last) : null;
}

export function toFormState(config: HomeConfig): HomeConfigFormState {
  const enabled = new Map(config.quickActions.map((a) => [a.key, a.enabled] as const));
  const quickActionEnabled = Object.fromEntries(
    QUICK_ACTION_ORDER.map((k) => [k, enabled.get(k) ?? false]),
  ) as Record<QuickActionKey, boolean>;
  return {
    themeColors: { ...(config.themeColors ?? homeConfig.DEFAULT_HOME_THEME) },
    title: config.title,
    tagline: config.tagline ?? "",
    bannerHeadline: config.bannerHeadline,
    bannerTagline: config.bannerTagline,
    bannerPreset: config.bannerPreset,
    bannerColorInput: config.bannerColor ?? "",
    bannerImageArtifactId: bannerArtifactIdFromUrl(config.bannerImageUrl),
    bannerImageUrl: config.bannerImageUrl,
    quickActionEnabled,
    sections: { ...config.sections },
    recommendedCapabilities: [...config.recommendedCapabilities],
    recommendedAgents: [...config.recommendedAgents],
  };
}

export function isFormDirty(baseline: HomeConfigFormState, form: HomeConfigFormState): boolean {
  return JSON.stringify(baseline) !== JSON.stringify(form);
}

/** 表单 → 提交体前的校验。返回「字段 → 人话」；空对象 = 通过。 */
export function validateForm(form: HomeConfigFormState): Record<string, string> {
  const v: Record<string, string> = {};
  if (Object.values(form.themeColors).some((color) => !isValidBannerColor(color))) v.themeColors = "主题颜色请使用 #RRGGBB 格式";
  if (form.title.trim().length === 0) v.title = "标题不能为空";
  else if (form.title.length > 24) v.title = "标题不能超过 24 字";
  if (form.tagline.length > 80) v.tagline = "一句话简介不能超过 80 字";
  if (form.bannerHeadline.trim().length === 0) v.bannerHeadline = "横幅主标题不能为空";
  else if (form.bannerHeadline.length > 60) v.bannerHeadline = "横幅主标题不能超过 60 字";
  if (form.bannerTagline.length > 120) v.bannerTagline = "横幅副标题不能超过 120 字";
  if (form.bannerPreset === "custom" && !isValidBannerColor(form.bannerColorInput)) {
    v.bannerColor = "自定义颜色请填 #RRGGBB 格式，例如 #2F6FED";
  }
  return v;
}

export function toUpdateInput(form: HomeConfigFormState): Omit<UpdateHomeConfigIn, "orgId"> {
  const tagline = form.tagline.trim();
  return {
    themeColors: form.themeColors,
    title: form.title.trim(),
    tagline: tagline.length > 0 ? tagline : null,
    bannerHeadline: form.bannerHeadline.trim(),
    bannerTagline: form.bannerTagline,
    bannerPreset: form.bannerPreset,
    bannerColor: form.bannerPreset === "custom" ? form.bannerColorInput : null,
    bannerImageArtifactId: form.bannerImageArtifactId,
    quickActions: QUICK_ACTION_ORDER.map((key, order) => ({ key, enabled: form.quickActionEnabled[key], order })),
    recommendedCapabilities: form.recommendedCapabilities,
    recommendedAgents: form.recommendedAgents,
    sections: form.sections,
  };
}

/**
 * 表单（可能未保存、可能有不合法的自定义色）→ 首页视图用的配置，供后台「预览」标签渲染。
 * 与真正保存后首页拿到的形状一致；自定义色非法时按「没有色值」渲染（首页 `HomeBanner`
 * 对 custom 缺色同样回落预设），预览因此不会画出保存后不会出现的样子。
 */
export function formToPreviewConfig(form: HomeConfigFormState, orgId: string): HomeConfig {
  const body = toUpdateInput(form);
  return {
    themeColors: form.themeColors,
    orgId,
    title: body.title,
    tagline: body.tagline,
    bannerHeadline: body.bannerHeadline,
    bannerTagline: body.bannerTagline,
    bannerPreset: body.bannerPreset,
    bannerColor: body.bannerColor !== null && isValidBannerColor(body.bannerColor) ? body.bannerColor : null,
    bannerImageUrl: form.bannerImageUrl,
    quickActions: body.quickActions,
    recommendedCapabilities: body.recommendedCapabilities,
    recommendedAgents: body.recommendedAgents,
    sections: body.sections,
    updatedAt: new Date(0).toISOString(),
    updatedBy: null,
  };
}
