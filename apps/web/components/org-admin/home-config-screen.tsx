"use client";

import * as React from "react";
import { Home } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { describeHomeConfigFailure } from "@/lib/home-config-failure";
import { getHomeConfig, updateHomeConfig, type HomeConfig } from "@/lib/live-home-config";
import { BannerSection, BasicFieldsSection } from "./home-config-appearance-section";
import { QuickActionsSection, SectionsSection } from "./home-config-content-sections";
import { RecommendedAgentsSection, RecommendedSkillsSection } from "./home-config-recommend-sections";
import { isFormDirty, toFormState, toUpdateInput, validateForm, type HomeConfigFormState } from "./home-config-form-model";

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
  const { session, identity } = useSession();
  const orgId = session?.currentOrgId ?? null;
  const isAdmin = identity?.orgRole === "admin";

  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);
  const [config, setConfig] = React.useState<HomeConfig | null>(null);
  const [form, setForm] = React.useState<HomeConfigFormState | null>(null);
  const [invalidFields, setInvalidFields] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    if (orgId === null) return;
    setState("loading");
    setFailureMessage(null);
    try {
      const out = await getHomeConfig(orgId);
      setConfig(out);
      setForm(toFormState(out));
      setState("default");
    } catch (err) {
      setFailureMessage(describeHomeConfigFailure(err));
      setState("dep-failed");
    }
  }, [orgId]);

  React.useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [load, isAdmin]);

  const dirty = config !== null && form !== null && isFormDirty(toFormState(config), form);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (orgId === null || form === null) return;
    const violations = validateForm(form);
    if (Object.keys(violations).length > 0) {
      setInvalidFields(violations);
      setState("invalid");
      return;
    }
    setState("loading");
    setFailureMessage(null);
    try {
      const out = await updateHomeConfig(orgId, toUpdateInput(form));
      setConfig(out);
      setForm(toFormState(out));
      setState("success");
    } catch (err) {
      setFailureMessage(describeHomeConfigFailure(err));
      setState("dep-failed");
    }
  }

  if (!isAdmin) {
    return (
      <HomeConfigShell>
        <div role="alert" data-testid="denied" className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted py-10 text-center">
          <p className="text-13 font-medium">你没有查看这块内容的权限</p>
          <p className="text-12 text-muted-foreground">组织层限制：首页配置仅组织管理员可进。</p>
        </div>
      </HomeConfigShell>
    );
  }

  return (
    <HomeConfigShell>
      <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-6" data-testid="home-config-form">
        <StateShell
          state={state}
          skeletonRows={5}
          errors={invalidFields}
          depFailure={{ what: failureMessage ?? "首页配置服务暂时不可用", retry: load }}
          successMessage="已保存"
        >
          {form !== null && orgId !== null ? (
            <div className="flex flex-col gap-6">
              <BasicFieldsSection form={form} onChange={setForm} />
              <BannerSection orgId={orgId} form={form} onChange={setForm} />
              <QuickActionsSection form={form} onChange={setForm} />
              <SectionsSection form={form} onChange={setForm} />
              <RecommendedAgentsSection form={form} onChange={setForm} />
              <RecommendedSkillsSection orgId={orgId} form={form} onChange={setForm} />
              <div className="flex items-center gap-2">
                <Button type="submit" variant="primary" disabled={!dirty} data-testid="home-config-save">保存</Button>
                {dirty ? <span className="text-11 text-muted-foreground">有未保存的更改</span> : null}
              </div>
            </div>
          ) : null}
        </StateShell>
      </form>
    </HomeConfigShell>
  );
}

function HomeConfigShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell previewRole={null} left={<AdminNav active="home-config" />}>
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6" data-testid="home-config-screen">
        <div className="flex items-center gap-2">
          <Home aria-hidden className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-16 font-semibold tracking-tight">首页配置</h1>
        </div>
        <p className="text-12 text-muted-foreground">配置本组织成员登录后第一落点（「首页」）的横幅、入口与推荐内容。</p>
        {children}
      </div>
    </AppShell>
  );
}
