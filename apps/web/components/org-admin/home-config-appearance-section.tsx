"use client";
import * as React from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { HomeBanner } from "@/components/home/home-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BANNER_PRESET_CATALOG, BANNER_PRESET_ORDER, isValidBannerColor } from "@/lib/home-config-catalog";
import { describeHomeConfigFailure } from "@/lib/home-config-failure";
import { HOME_BANNER_ACCEPT, HOME_BANNER_MAX_BYTES, uploadHomeBanner } from "@/lib/live-home-config";
import { cn } from "@/lib/utils";
import type { HomeConfigFormState } from "./home-config-form-model";

type Props = { form: HomeConfigFormState; onChange: (next: HomeConfigFormState) => void };

const SECTION = "flex flex-col gap-4 rounded-lg border border-border bg-panel p-4";

export function BasicFieldsSection({ form, onChange }: Props) {
  return (
    <section className={SECTION}>
      <h2 className="text-13 font-semibold text-card-foreground">基本信息</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-title">品牌标题（最多 24 字）</Label>
        <Input id="home-config-title" value={form.title} maxLength={24} onChange={(e) => onChange({ ...form, title: e.target.value })} data-testid="home-config-title" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-tagline">一句话简介（可选，最多 80 字）</Label>
        <Input id="home-config-tagline" value={form.tagline} maxLength={80} onChange={(e) => onChange({ ...form, tagline: e.target.value })} data-testid="home-config-tagline" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-banner-headline">横幅主标题（最多 60 字）</Label>
        <Input id="home-config-banner-headline" value={form.bannerHeadline} maxLength={60} onChange={(e) => onChange({ ...form, bannerHeadline: e.target.value })} data-testid="home-config-banner-headline" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-banner-tagline">横幅副标题（最多 120 字）</Label>
        <Textarea id="home-config-banner-tagline" value={form.bannerTagline} maxLength={120} onChange={(e) => onChange({ ...form, bannerTagline: e.target.value })} data-testid="home-config-banner-tagline" />
      </div>
    </section>
  );
}

/** 横幅：配色预设 + 自定义 #RRGGBB + 上传图片，底部是与成员所见同一组件的实时预览。 */
export function BannerSection({ orgId, form, onChange }: Props & { orgId: string }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  const customValid = isValidBannerColor(form.bannerColorInput);
  const custom = form.bannerPreset === "custom";

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    setUploadError(null);
    if (file.size > HOME_BANNER_MAX_BYTES) {
      setUploadError("图片超过 5MB，换一张小一点的");
      return;
    }
    setUploading(true);
    try {
      const out = await uploadHomeBanner({ orgId, file });
      onChange({ ...form, bannerImageArtifactId: out.bannerImageArtifactId, bannerImageUrl: out.bannerImageUrl });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) setUploadError("上传超时，请重试");
      else setUploadError(describeHomeConfigFailure(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className={SECTION} data-testid="home-config-banner-section">
      <h2 className="text-13 font-semibold text-card-foreground">横幅</h2>

      <div className="flex flex-col gap-2">
        <Label>配色</Label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {BANNER_PRESET_ORDER.map((key) => {
            const active = form.bannerPreset === key;
            const meta = BANNER_PRESET_CATALOG[key];
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ ...form, bannerPreset: key })}
                data-testid={`home-config-banner-preset-${key}`}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-card border p-2 text-11 transition-colors duration-fast",
                  active ? "border-primary bg-accent" : "border-border-subtle hover:bg-muted",
                )}
              >
                <span className={cn("h-8 w-full rounded-control", meta.className)} />
                {meta.label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={custom}
            onClick={() => onChange({ ...form, bannerPreset: "custom", bannerColorInput: form.bannerColorInput || "#2F6FED" })}
            data-testid="home-config-banner-preset-custom"
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-card border p-2 text-11 transition-colors duration-fast",
              custom ? "border-primary bg-accent" : "border-border-subtle hover:bg-muted",
            )}
          >
            <span
              className="h-8 w-full rounded-control border border-border-subtle bg-muted"
              style={customValid ? { backgroundColor: form.bannerColorInput } : undefined}
            />
            自定义
          </button>
        </div>

        {custom ? (
          <div className="flex flex-col gap-1.5" data-testid="home-config-custom-color">
            <Label htmlFor="home-config-banner-color">自定义颜色（#RRGGBB）</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="取色器"
                value={customValid ? form.bannerColorInput.toLowerCase() : "#2f6fed"}
                onChange={(e) => onChange({ ...form, bannerColorInput: e.target.value.toUpperCase() })}
                data-testid="home-config-banner-color-picker"
                className="h-8 w-10 cursor-pointer rounded-control border border-input bg-card p-0.5"
              />
              <Input
                id="home-config-banner-color"
                value={form.bannerColorInput}
                maxLength={7}
                placeholder="#2F6FED"
                spellCheck={false}
                aria-invalid={!customValid}
                onChange={(e) => onChange({ ...form, bannerColorInput: e.target.value.trim() })}
                data-testid="home-config-banner-color-input"
                className="w-32 font-mono uppercase"
              />
            </div>
            {!customValid ? (
              <p role="alert" className="text-11 text-destructive" data-testid="home-config-banner-color-error">
                请填 #RRGGBB 格式，例如 #2F6FED
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label>背景图片（可选，PNG / JPEG / WebP，最大 5MB）</Label>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept={HOME_BANNER_ACCEPT} className="sr-only" onChange={(e) => void handlePick(e)} data-testid="home-config-banner-file-input" />
          <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="home-config-banner-upload">
            <ImagePlus aria-hidden className="h-3.5 w-3.5" />
            {uploading ? "上传中…" : form.bannerImageUrl ? "更换图片" : "上传图片"}
          </Button>
          {form.bannerImageUrl ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...form, bannerImageArtifactId: null, bannerImageUrl: null })} data-testid="home-config-banner-remove">
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
              移除图片
            </Button>
          ) : null}
        </div>
        <p className="text-11 text-muted-foreground">设置图片后以图片为背景（上面盖一层渐变保证文字可读）；移除后使用上面的配色。</p>
        {uploadError !== null ? <p role="alert" className="text-11 text-destructive" data-testid="home-config-banner-upload-error">{uploadError}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>预览（成员看到的样子）</Label>
        <HomeBanner
          orgId={orgId}
          title={form.title || "标题"}
          greeting="你好，成员"
          headline={form.bannerHeadline}
          tagline={form.bannerTagline}
          preset={form.bannerPreset}
          color={customValid ? form.bannerColorInput : null}
          imageUrl={form.bannerImageUrl}
          className="py-6"
        />
      </div>
    </section>
  );
}
