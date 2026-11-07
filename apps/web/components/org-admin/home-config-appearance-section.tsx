"use client";
import * as React from "react";
import type { Locale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";
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
  const { t } = useI18n();
  return (
    <section className={SECTION}>
      <h2 className="text-13 font-semibold text-card-foreground">{t("homeConfig.basic")}</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-title">{t("homeConfig.titleLabel")}</Label>
        <Input id="home-config-title" value={form.title} maxLength={24} onChange={(e) => onChange({ ...form, title: e.target.value })} data-testid="home-config-title" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-tagline">{t("homeConfig.taglineLabel")}</Label>
        <Input id="home-config-tagline" value={form.tagline} maxLength={80} onChange={(e) => onChange({ ...form, tagline: e.target.value })} data-testid="home-config-tagline" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-banner-headline">{t("homeConfig.headlineLabel")}</Label>
        <Input id="home-config-banner-headline" value={form.bannerHeadline} maxLength={60} onChange={(e) => onChange({ ...form, bannerHeadline: e.target.value })} data-testid="home-config-banner-headline" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-banner-tagline">{t("homeConfig.subtitleLabel")}</Label>
        <Textarea id="home-config-banner-tagline" value={form.bannerTagline} maxLength={120} onChange={(e) => onChange({ ...form, bannerTagline: e.target.value })} data-testid="home-config-banner-tagline" />
      </div>
    </section>
  );
}

/** 横幅：配色预设 + 自定义 #RRGGBB + 上传图片，底部是与成员所见同一组件的实时预览。 */
export function BannerSection({ orgId, form, onChange }: Props & { orgId: string }) {
  const { t, locale } = useI18n();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<((locale: Locale) => string) | null>(null);

  const customValid = isValidBannerColor(form.bannerColorInput);
  const custom = form.bannerPreset === "custom";

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    setUploadError(null);
    if (file.size > HOME_BANNER_MAX_BYTES) {
      setUploadError(() => (locale: Locale) => translate(locale, "homeConfig.bannerTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const out = await uploadHomeBanner({ orgId, file });
      onChange({ ...form, bannerImageArtifactId: out.bannerImageArtifactId, bannerImageUrl: out.bannerImageUrl });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) setUploadError(() => (locale: Locale) => translate(locale, "homeConfig.uploadTimeout"));
      else setUploadError(() => (locale: Locale) => describeHomeConfigFailure(err, locale));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className={SECTION} data-testid="home-config-banner-section">
      <h2 className="text-13 font-semibold text-card-foreground">{t("homeConfig.banner")}</h2>

      <div className="flex flex-col gap-2">
        <Label>{t("homeConfig.colors")}</Label>
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
                {t(`homeConfig.preset.${key}`)}
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
            {t("homeConfig.custom")}
          </button>
        </div>

        {custom ? (
          <div className="flex flex-col gap-1.5" data-testid="home-config-custom-color">
            <Label htmlFor="home-config-banner-color">{t("homeConfig.customColor")}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={t("homeConfig.colorPicker")}
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
                {t("homeConfig.colorInvalid")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("homeConfig.backgroundImage")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept={HOME_BANNER_ACCEPT} className="sr-only" onChange={(e) => void handlePick(e)} data-testid="home-config-banner-file-input" />
          <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="home-config-banner-upload">
            <ImagePlus aria-hidden className="h-3.5 w-3.5" />
            {uploading ? t("homeConfig.uploading") : form.bannerImageUrl ? t("homeConfig.changeImage") : t("homeConfig.uploadImage")}
          </Button>
          {form.bannerImageUrl ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...form, bannerImageArtifactId: null, bannerImageUrl: null })} data-testid="home-config-banner-remove">
              <Trash2 aria-hidden className="h-3.5 w-3.5" />
              {t("homeConfig.removeImage")}
            </Button>
          ) : null}
        </div>
        <p className="text-11 text-muted-foreground">{t("homeConfig.backgroundHelp")}</p>
        {uploadError !== null ? <p role="alert" className="text-11 text-destructive" data-testid="home-config-banner-upload-error">{uploadError(locale)}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("homeConfig.bannerPreview")}</Label>
        <HomeBanner
          orgId={orgId}
          title={form.title || t("homeConfig.titleFallback")}
          greeting={t("homeConfig.greeting")}
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
