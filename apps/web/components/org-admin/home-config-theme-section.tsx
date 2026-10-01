"use client";
import * as React from "react";
import { ImagePlus, Sparkles, Trash2 } from "lucide-react";
import { homeConfig } from "@repo/contracts";
import { useSession } from "@/components/session/session-provider";
import { invalidateOrgAvatar, useOrgAvatarUrl } from "@/components/shell/org-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl } from "@/lib/api-client";
import { useAuthedImageSrc } from "@/lib/use-authed-image-src";
import { updateOrganization, uploadOrgAvatar } from "@/lib/live-org-admin";
import { describeHomeConfigFailure } from "@/lib/home-config-failure";
import { homeThemeStyle, paletteFromImage, THEME_LABELS, type ThemeColors } from "@/lib/home-theme";
import type { HomeConfigFormState } from "./home-config-form-model";

export function HomeThemeSection({ orgId, form, onChange }: {
  orgId: string; form: HomeConfigFormState; onChange: (form: HomeConfigFormState) => void;
}) {
  const { identity } = useSession();
  const avatarUrl = useOrgAvatarUrl(orgId, identity?.org.avatarUrl ?? null, true);
  const { src } = useAuthedImageSrc(avatarUrl ? apiUrl(avatarUrl) : null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const latest = React.useRef(form);
  latest.current = form;
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function generate(source: string) {
    const colors = await paletteFromImage(source);
    onChange({ ...latest.current, themeColors: colors });
    setMessage("已从 Logo 生成主题颜色，保存后应用到组织首页。");
  }
  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError(null); setMessage(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
      setError("请选择不超过 5MB 的 PNG、JPEG 或 WebP 图片"); return;
    }
    setBusy(true);
    const local = URL.createObjectURL(file);
    try {
      const colors = await paletteFromImage(local);
      const uploaded = await uploadOrgAvatar({ orgId, file });
      await updateOrganization({ orgId, avatarArtifactId: uploaded.orgAvatarArtifactId });
      invalidateOrgAvatar(orgId);
      onChange({ ...latest.current, themeColors: colors });
      setMessage("组织 Logo 已更新；自动生成的主题颜色在保存后生效。");
    } catch (err) { setError(describeHomeConfigFailure(err)); }
    finally { URL.revokeObjectURL(local); setBusy(false); }
  }
  async function autoGenerate() {
    if (!src) return;
    setBusy(true); setError(null); setMessage(null);
    try { await generate(src); }
    catch { setError("无法读取 Logo 的颜色，请重新上传或手动设置。"); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(null); setMessage(null);
    try {
      await updateOrganization({ orgId, avatarArtifactId: null });
      invalidateOrgAvatar(orgId);
      setMessage("组织 Logo 已移除，主题颜色保留。");
    } catch (err) { setError(describeHomeConfigFailure(err)); }
    finally { setBusy(false); }
  }
  return (
    <section className="flex flex-col gap-6 rounded-xl border border-border bg-panel p-5" data-testid="home-config-theme">
      <div>
        <h2 className="text-16 font-semibold">Logo 与品牌</h2>
        <div className="mt-3 flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-border bg-card">
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated blob */}
            {src ? <img src={src} alt="组织 Logo" className="h-16 w-16 object-contain" /> : <ImagePlus aria-hidden className="h-7 w-7 text-muted-foreground" />}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void pick(e)} data-testid="home-logo-file" />
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus className="h-3.5 w-3.5" />{busy ? "处理中…" : "更换 Logo"}</Button>
              <Button type="button" variant="outline" size="sm" disabled={busy || !avatarUrl} onClick={() => void remove()}><Trash2 className="h-3.5 w-3.5" />移除</Button>
            </div>
            <p className="text-11 text-muted-foreground">建议 512 × 512，最大 5MB。Logo 更改立即同步到组织资料。</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-16 font-semibold">主题颜色</h2>
        <Button type="button" variant="outline" size="sm" disabled={busy || !src} onClick={() => void autoGenerate()} data-testid="home-theme-generate"><Sparkles className="h-3.5 w-3.5" />从 Logo 自动生成</Button>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {(Object.keys(THEME_LABELS) as (keyof ThemeColors)[]).map((key) => (
          <label key={key} className="flex min-w-0 flex-col gap-2 text-center text-11 text-muted-foreground">
            <input type="color" aria-label={`${THEME_LABELS[key]}取色器`} value={/^#[0-9a-f]{6}$/i.test(form.themeColors[key]) ? form.themeColors[key] : homeConfig.DEFAULT_HOME_THEME[key]} onChange={(e) => onChange({ ...form, themeColors: { ...form.themeColors, [key]: e.target.value.toUpperCase() } })} className="h-12 w-full cursor-pointer rounded-lg border border-border bg-card p-1" />
            {THEME_LABELS[key]}
            <Input aria-label={`${THEME_LABELS[key]}色值`} value={form.themeColors[key]} maxLength={7} onChange={(e) => onChange({ ...form, themeColors: { ...form.themeColors, [key]: e.target.value } })} className="px-1 text-center font-mono text-11" />
          </label>
        ))}
      </div>
      <div style={homeThemeStyle(form.themeColors)} className="rounded-xl bg-muted/50 p-4" data-testid="home-theme-preview">
        <p className="mb-3 text-12 font-semibold">颜色预览</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-24 font-semibold">Aa</span>
          <Button type="button" variant="primary">主色按钮</Button>
          <span className="rounded-lg bg-secondary px-4 py-2 text-12 text-secondary-foreground">辅助色</span>
          <span className="rounded-lg bg-accent px-4 py-2 text-12 text-accent-foreground">强调色</span>
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" className="self-start" disabled={busy} onClick={() => onChange({ ...form, themeColors: { ...homeConfig.DEFAULT_HOME_THEME } })}>恢复默认主题颜色</Button>
      {message ? <p role="status" className="text-12 text-muted-foreground">{message}</p> : null}
      {error ? <p role="alert" className="text-12 text-destructive">{error}</p> : null}
    </section>
  );
}
