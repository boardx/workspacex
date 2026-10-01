"use client";
import * as React from "react";
import { useOptionalSession } from "@/components/session/session-provider";
import { useOrgAvatarUrl } from "@/components/shell/org-menu";
import { apiUrl } from "@/lib/api-client";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";
import { BANNER_PRESET_CATALOG, isValidBannerColor, readableTextOn } from "@/lib/home-config-catalog";
import type { BannerPreset } from "@/lib/live-home-config";
import { cn } from "@/lib/utils";

/**
 * 首页横幅：首页与后台配置屏的「实时预览」共用同一个组件，预览看到的就是成员看到的。
 * 背景优先级：上传图片 > 自定义色 > 预设渐变。图片走鉴权拉取（`useAuthedImageSrc`，
 * 裸 `<img src>` 发不出 Bearer 头）；拉取失败回落到配色，不留一块空白。
 */
export interface HomeBannerProps {
  readonly orgId?: string | null;
  readonly title: string;
  readonly greeting: string;
  readonly headline: string;
  readonly tagline: string;
  readonly preset: BannerPreset;
  readonly color: string | null;
  readonly imageUrl: string | null;
  readonly className?: string;
}

// 自定义底色上的字色：按对比度在浅/深两档里选（不依赖主题 token，主题切换也不变）。
const TEXT_ON_DARK = "rgb(255 255 255)";
const TEXT_ON_LIGHT = "rgb(23 23 26)";

export function HomeBanner({ orgId, title, greeting, headline, tagline, preset, color, imageUrl, className }: HomeBannerProps) {
  const session = useOptionalSession();
  const logoUrl = useOrgAvatarUrl(orgId ?? session?.identity?.org.id ?? "", session?.identity?.org.avatarUrl ?? null, session?.identity?.orgRole === "admin");
  const { src: logo } = useAuthedImageSrc(logoUrl ? apiUrl(logoUrl) : null);
  const { src } = useAuthedImageSrc(imageUrl === null ? null : apiUrl(imageUrl));
  const customColor = preset === "custom" && color !== null && isValidBannerColor(color) ? color : null;
  const presetMeta = preset === "custom" ? BANNER_PRESET_CATALOG.ocean : BANNER_PRESET_CATALOG[preset];
  const hasImage = src !== null;

  let style: React.CSSProperties | undefined;
  let textClass = "text-inverse-foreground";
  if (!hasImage && customColor !== null) {
    style = { backgroundColor: customColor, color: readableTextOn(customColor) === "light" ? TEXT_ON_DARK : TEXT_ON_LIGHT };
    textClass = "";
  }
  const subtle = hasImage || customColor === null ? "opacity-80" : "opacity-80";

  return (
    <section
      aria-label="组织首页横幅"
      data-testid="home-banner"
      data-banner-source={hasImage ? "image" : customColor !== null ? "custom" : "preset"}
      style={style}
      className={cn(
        "relative overflow-hidden rounded-container px-6 py-10 sm:px-10 sm:py-12 shadow-sm",
        !hasImage && customColor === null && presetMeta.className,
        textClass,
        className,
      )}
    >
      {hasImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- 鉴权拉取得到的 Blob URL，不是可优化的静态资源 */}
          <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" data-testid="home-banner-image" />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-inverse/70 via-inverse/30 to-transparent" />
        </>
      ) : null}
      <div className={cn("relative flex items-start gap-6", hasImage && "text-inverse-foreground")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated organization logo */}
        {logo ? <img src={logo} alt="组织 Logo" className="hidden h-24 w-24 shrink-0 object-contain sm:block" /> : null}
        <div>
        <p className="max-w-lg text-[36px] sm:text-[44px] font-semibold leading-tight tracking-tight">{title}</p>
        <h1 className="mt-2 max-w-lg text-13 font-medium leading-tight" data-testid="home-greeting">{greeting}</h1>
        <h2 className={cn("mt-3 max-w-lg text-20 font-medium leading-snug", subtle)}>{headline}</h2>
        {tagline.length > 0 ? <p className={cn("mt-1 max-w-md text-11", subtle)}>{tagline}</p> : null}
        </div>
      </div>
    </section>
  );
}
