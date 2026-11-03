"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { Eye, Home, Pencil } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { HomeView } from "@/components/home/home-screen";
import { cn } from "@/lib/utils";
import { describeHomeConfigFailure } from "@/lib/home-config-failure";
import { getHomeConfig, updateHomeConfig, type HomeConfig } from "@/lib/live-home-config";
import { HomeThemeSection } from "./home-config-theme-section";
import { BannerSection, BasicFieldsSection } from "./home-config-appearance-section";
import { QuickActionsSection, SectionsSection } from "./home-config-content-sections";
import { RecommendedAgentsSection, RecommendedSkillsSection } from "./home-config-recommend-sections";
import { formToPreviewConfig, isFormDirty, toFormState, toUpdateInput, validateForm, type HomeConfigFormState } from "./home-config-form-model";

/**
 * `/org-admin/home-config` —— 组织首页配置（ad-hoc feature，Refs #4634 / #4698）。
 *
 * 与 `/org-admin/profile` 同一个授权面（组织 admin），归在同一组左栏（见
 * `lib/mock/admin.ts` 的 `home-config` 项）。这里配的就是 `/home` 读的那份 `HomeConfig`
 * ——同一份事实，一处写、一处读，不在任何一边编第二份默认文案；横幅预览直接复用首页的
 * `HomeBanner`，预览即所见。表单模型与校验在 `home-config-form-model.ts`（纯函数，可单测）。
 *
 * 推荐的数字人/Skill 选中时把展示信息快照进配置（见契约头注），首页读取不反查那两个目录。
 */
export function HomeConfigScreen() {
  const { t, locale } = useI18n();
  const { session, identity } = useSession();
  const orgId = session?.currentOrgId ?? null;
  const isAdmin = identity?.orgRole === "admin";

  const [state, setState] = React.useState<UiState>("loading");
  const [failure, setFailure] = React.useState<{ error: unknown } | null>(null);
  const failureMessage = failure ? describeHomeConfigFailure(failure.error, locale) : null;
  const [config, setConfig] = React.useState<HomeConfig | null>(null);
  const [form, setForm] = React.useState<HomeConfigFormState | null>(null);
  const [invalidForm, setInvalidForm] = React.useState<HomeConfigFormState | null>(null);
  const invalidFields = invalidForm ? validateForm(invalidForm, locale) : {};
  const [tab, setTab] = React.useState<"edit" | "content" | "layout" | "preview">("edit");

  const load = React.useCallback(async () => {
    if (orgId === null) return;
    setState("loading");
    setFailure(null);
    try {
      const out = await getHomeConfig(orgId);
      setConfig(out);
      setForm(toFormState(out));
      setState("default");
    } catch (err) {
      setFailure({ error: err });
      setState("dep-failed");
    }
  }, [orgId]);

  React.useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [load, isAdmin]);

  const dirty = config !== null && form !== null && isFormDirty(toFormState(config), form);

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    if (orgId === null || form === null) return;
    const violations = validateForm(form);
    if (Object.keys(violations).length > 0) {
      setInvalidForm(form);
      setState("invalid");
      return;
    }
    setState("loading");
    setFailure(null);
    try {
      const out = await updateHomeConfig(orgId, toUpdateInput(form));
      setConfig(out);
      setForm(toFormState(out));
      setState("success");
    } catch (err) {
      setFailure({ error: err });
      setState("dep-failed");
    }
  }

  if (!isAdmin) {
    return (
      <HomeConfigShell>
        <div role="alert" data-testid="denied" className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted py-10 text-center">
          <p className="text-13 font-medium">{t("homeConfig.deniedTitle")}</p>
          <p className="text-12 text-muted-foreground">{t("homeConfig.denied")}</p>
        </div>
      </HomeConfigShell>
    );
  }

  const previewing = tab === "preview" && form !== null && orgId !== null;
  return (
    <HomeConfigShell wide={previewing}>
      {form !== null && orgId !== null ? (
        <div role="tablist" aria-label={t("homeConfig.views")} className="flex flex-wrap gap-1 border-b border-border" data-testid="home-config-tabs">
          {([["edit", t("homeConfig.appearance"), Pencil], ["content", t("homeConfig.content"), Home], ["layout", t("homeConfig.layout"), Home], ["preview", t("homeConfig.preview"), Eye]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              data-testid={`home-config-tab-${key}`}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-12 font-medium transition-colors duration-fast",
                tab === key ? "border-primary text-card-foreground" : "border-transparent text-muted-foreground hover:text-card-foreground",
              )}
            >
              <Icon aria-hidden className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
      ) : null}

      {previewing ? (
        <HomePreviewPane
          form={form}
          orgId={orgId}
          displayName={identity?.displayName ?? null}
          dirty={dirty}
          invalid={Object.keys(validateForm(form)).length > 0}
          saving={state === "loading"}
          status={state === "success" ? { ok: true, text: t("state.saved") } : state === "dep-failed" ? { ok: false, text: failureMessage ?? t("homeConfig.saveFailed") } : null}
          onBack={() => setTab("edit")}
          onSave={() => void handleSave()}
        />
      ) : (
        <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-6" data-testid="home-config-form">
          <StateShell
            state={state}
            skeletonRows={5}
            errors={invalidFields}
            depFailure={{ what: failureMessage ?? t("homeConfig.unavailable"), retry: load }}
            successMessage={t("state.saved")}
          >
            {form !== null && orgId !== null ? (
              <div className="flex flex-col gap-6">
                <div hidden={tab !== "edit"} className={cn("flex-col gap-6", tab === "edit" ? "flex" : "hidden")}>
                <HomeThemeSection orgId={orgId} form={form} onChange={setForm} />
                <BasicFieldsSection form={form} onChange={setForm} />
                <BannerSection orgId={orgId} form={form} onChange={setForm} />
                </div>
                <div hidden={tab !== "layout"} className={cn("flex-col gap-6", tab === "layout" ? "flex" : "hidden")}>
                <QuickActionsSection form={form} onChange={setForm} />
                <SectionsSection form={form} onChange={setForm} />
                </div>
                <div hidden={tab !== "content"} className={cn("flex-col gap-6", tab === "content" ? "flex" : "hidden")}>
                <RecommendedAgentsSection form={form} onChange={setForm} />
                <RecommendedSkillsSection orgId={orgId} form={form} onChange={setForm} />
                </div>
                <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-panel py-4">
                  <Button type="submit" variant="primary" disabled={!dirty} data-testid="home-config-save">{t("common.save")}</Button>
                  <Button type="button" variant="outline" onClick={() => setTab("preview")} data-testid="home-config-open-preview">
                    <Eye aria-hidden className="h-3.5 w-3.5" />{t("homeConfig.preview")}
                  </Button>
                  {dirty ? <span className="text-11 text-muted-foreground">{t("homeConfig.unsaved")}</span> : null}
                </div>
              </div>
            ) : null}
          </StateShell>
        </form>
      )}
    </HomeConfigShell>
  );
}

/**
 * 「预览首页」：把表单里**当前**（含未保存）的配置喂给首页同一个 `HomeView`，所见即所得。
 * 预览区是 `inert` 的——里面的链接/按钮不可点、不可聚焦，避免在预览里点走丢了编辑内容，
 * 也不会真的触发「点 Skill 新建对话」。个人数据（继续你的工作/当前任务）取自当前管理员自己的账号。
 */
export function HomePreviewPane({
  form, orgId, displayName, dirty, invalid, saving, status, onBack, onSave,
}: {
  form: HomeConfigFormState;
  orgId: string;
  displayName: string | null;
  dirty: boolean;
  invalid: boolean;
  saving: boolean;
  status: { ok: boolean; text: string } | null;
  onBack: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const config = React.useMemo(() => formToPreviewConfig(form, orgId), [form, orgId]);
  return (
    <div className="flex flex-col gap-3" data-testid="home-config-preview">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-11 text-muted-foreground">
        <span className="min-w-0 flex-1">
          {dirty ? t("homeConfig.previewDirty") : t("homeConfig.previewSaved")}
          {" "}{t("homeConfig.previewPersonal")}
          {invalid ? <span className="ml-1 text-destructive" data-testid="home-config-preview-invalid">{t("homeConfig.previewInvalid")}</span> : null}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={onBack} data-testid="home-config-preview-back">{t("homeConfig.back")}</Button>
        {status !== null ? (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "text-success" : "text-destructive"} data-testid="home-config-preview-status">{status.text}</span>
        ) : null}
        <Button type="button" size="sm" variant="primary" disabled={!dirty || invalid || saving} onClick={onSave} data-testid="home-config-preview-save">{saving ? t("common.saving") : t("common.save")}</Button>
      </div>
      <div
        ref={(el) => { el?.setAttribute("inert", ""); }}
        aria-label={t("homeConfig.previewLabel")}
        className="overflow-hidden rounded-lg border border-border bg-background"
        data-testid="home-config-preview-frame"
      >
        <HomeView config={config} orgId={orgId} displayName={displayName} />
      </div>
    </div>
  );
}

function HomeConfigShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return (
    <AppShell previewRole={null} left={<AdminNav active="home-config" />}>
      <div className={cn("mx-auto flex flex-col gap-6 p-6", wide ? "max-w-6xl" : "max-w-2xl")} data-testid="home-config-screen">
        <div className="flex items-center gap-2">
          <Home aria-hidden className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-24 font-semibold tracking-tight">{t("adminNavigation.item.home-config")}</h1>
        </div>
        <p className="text-12 text-muted-foreground">{t("homeConfig.help")}</p>
        {children}
      </div>
    </AppShell>
  );
}
