"use client";

import * as React from "react";
import { Home, Bot, Sparkles, X, Plus } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  getHomeConfig, updateHomeConfig,
  type HomeConfig, type QuickActionKey, type BannerPreset, type RecommendedCapability,
} from "@/lib/live-home-config";
import { listAgents, type AgentListRow } from "@/lib/agent-definition";
import { listSkills, type SkillListItem } from "@/lib/live-skill";

/**
 * `/org-admin/home-config` —— 组织首页配置（ad-hoc feature，Refs #4634）。
 *
 * 与 `/org-admin/profile` 同一个授权面（组织 admin），归在同一组左栏（见
 * `lib/mock/admin.ts` 的 `home-config` 项）。这里配的就是 `/home`
 * （`components/home/home-screen.tsx`）读的那份 `HomeConfig`——同一份事实，
 * 一处写、一处读，不在任何一边编第二份默认文案。
 *
 * `recommendedCapabilities` 引用真实 Agent/Skill（见契约头注 AR13）：选中时把
 * 展示名快照进配置，`/home` 读取不反查 `listAgents`/`listSkills`（那两个列表本身
 * admin-only，首页对普通成员不能因为这张配置多开一个后门）。
 */

const QUICK_ACTION_META: ReadonlyArray<{ key: QuickActionKey; label: string }> = [
  { key: "chat", label: "对话" },
  { key: "projects", label: "项目" },
  { key: "board", label: "Board" },
  { key: "brain", label: "大脑" },
];

const BANNER_PRESET_META: ReadonlyArray<{ key: BannerPreset; label: string; swatchClass: string }> = [
  { key: "ocean", label: "海洋", swatchClass: "bg-inverse" },
  { key: "forest", label: "森林", swatchClass: "bg-gradient-to-br from-success to-ai" },
  { key: "sunset", label: "日落", swatchClass: "bg-gradient-to-br from-warning to-destructive" },
  { key: "midnight", label: "午夜", swatchClass: "bg-inverse" },
];

type FormState = {
  title: string;
  tagline: string;
  bannerHeadline: string;
  bannerTagline: string;
  bannerPreset: BannerPreset;
  quickActionEnabled: Record<QuickActionKey, boolean>;
  recommendedCapabilities: RecommendedCapability[];
};

function toFormState(config: HomeConfig): FormState {
  const enabledByKey = new Map(config.quickActions.map((a) => [a.key, a.enabled]));
  return {
    title: config.title,
    tagline: config.tagline ?? "",
    bannerHeadline: config.bannerHeadline,
    bannerTagline: config.bannerTagline,
    bannerPreset: config.bannerPreset,
    quickActionEnabled: {
      chat: enabledByKey.get("chat") ?? false,
      projects: enabledByKey.get("projects") ?? false,
      board: enabledByKey.get("board") ?? false,
      brain: enabledByKey.get("brain") ?? false,
    },
    recommendedCapabilities: [...config.recommendedCapabilities],
  };
}

function describeFailure(failure: unknown): string {
  if (failure instanceof ApiError) {
    if (failure.status === 401) return "登录已失效（HTTP 401），请重新登录。";
    if (failure.status === 403) return "首页配置仅组织管理员可编辑（HTTP 403）。";
    return `${failure.reasonCode ?? "加载失败"}（HTTP ${failure.status}）`;
  }
  return failure instanceof Error ? failure.message : "加载失败，请稍后重试。";
}

export function HomeConfigScreen() {
  const { session, identity } = useSession();
  const orgId = session?.currentOrgId ?? null;
  const isAdmin = identity?.orgRole === "admin";

  const [state, setState] = React.useState<UiState>("loading");
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null);
  const [config, setConfig] = React.useState<HomeConfig | null>(null);
  const [form, setForm] = React.useState<FormState | null>(null);
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
      setFailureMessage(describeFailure(err));
      setState("dep-failed");
    }
  }, [orgId]);

  React.useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [load, isAdmin]);

  const dirty = config !== null && form !== null && (() => {
    const baseline = toFormState(config);
    return JSON.stringify(baseline) !== JSON.stringify(form);
  })();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (orgId === null || form === null) return;
    const violations: Record<string, string> = {};
    if (form.title.trim().length === 0) violations.title = "标题不能为空";
    if (form.title.length > 24) violations.title = "标题不能超过 24 字";
    if (form.tagline.length > 80) violations.tagline = "一句话简介不能超过 80 字";
    if (form.bannerHeadline.trim().length === 0) violations.bannerHeadline = "横幅主标题不能为空";
    if (form.bannerHeadline.length > 60) violations.bannerHeadline = "横幅主标题不能超过 60 字";
    if (form.bannerTagline.length > 120) violations.bannerTagline = "横幅副标题不能超过 120 字";
    if (Object.keys(violations).length > 0) {
      setInvalidFields(violations);
      setState("invalid");
      return;
    }
    setState("loading");
    setFailureMessage(null);
    try {
      const quickActions = QUICK_ACTION_META.map((meta, order) => ({
        key: meta.key,
        enabled: form.quickActionEnabled[meta.key],
        order,
      }));
      const out = await updateHomeConfig(orgId, {
        title: form.title.trim(),
        tagline: form.tagline.trim().length > 0 ? form.tagline.trim() : null,
        bannerHeadline: form.bannerHeadline.trim(),
        bannerTagline: form.bannerTagline,
        bannerPreset: form.bannerPreset,
        quickActions,
        recommendedCapabilities: form.recommendedCapabilities,
      });
      setConfig(out);
      setForm(toFormState(out));
      setState("success");
    } catch (err) {
      setFailureMessage(describeFailure(err));
      setState("dep-failed");
    }
  }

  if (!isAdmin) {
    return (
      <HomeConfigShell>
        <div
          role="alert"
          data-testid="denied"
          className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted py-10 text-center"
        >
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
          {form !== null ? (
            <div className="flex flex-col gap-6">
              <BasicFieldsSection form={form} onChange={setForm} />
              <BannerPresetSection form={form} onChange={setForm} />
              <QuickActionsSection form={form} onChange={setForm} />
              <RecommendedCapabilitiesSection orgId={orgId} form={form} onChange={setForm} />
              <div className="flex items-center gap-2">
                <Button type="submit" variant="primary" disabled={!dirty} data-testid="home-config-save">
                  保存
                </Button>
                {dirty && <span className="text-11 text-muted-foreground">有未保存的更改</span>}
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
        <p className="text-12 text-muted-foreground">
          配置本组织成员登录后第一落点（「首页」）的横幅、快捷入口与推荐内容。
        </p>
        {children}
      </div>
    </AppShell>
  );
}

function BasicFieldsSection({
  form, onChange,
}: {
  form: FormState;
  onChange: (next: FormState) => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-panel p-4">
      <h2 className="text-13 font-semibold text-card-foreground">基本信息</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-title">标题（首页横幅上方小字，最多 24 字）</Label>
        <Input
          id="home-config-title"
          value={form.title}
          maxLength={24}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          data-testid="home-config-title"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-tagline">一句话简介（可选，最多 80 字）</Label>
        <Input
          id="home-config-tagline"
          value={form.tagline}
          maxLength={80}
          onChange={(e) => onChange({ ...form, tagline: e.target.value })}
          data-testid="home-config-tagline"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-banner-headline">横幅主标题（最多 60 字）</Label>
        <Input
          id="home-config-banner-headline"
          value={form.bannerHeadline}
          maxLength={60}
          onChange={(e) => onChange({ ...form, bannerHeadline: e.target.value })}
          data-testid="home-config-banner-headline"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="home-config-banner-tagline">横幅副标题（最多 120 字）</Label>
        <Textarea
          id="home-config-banner-tagline"
          value={form.bannerTagline}
          maxLength={120}
          onChange={(e) => onChange({ ...form, bannerTagline: e.target.value })}
          data-testid="home-config-banner-tagline"
        />
      </div>
    </section>
  );
}

function BannerPresetSection({
  form, onChange,
}: {
  form: FormState;
  onChange: (next: FormState) => void;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4">
      <h2 className="text-13 font-semibold text-card-foreground">横幅配色</h2>
      <div className="grid grid-cols-4 gap-2">
        {BANNER_PRESET_META.map((preset) => {
          const active = form.bannerPreset === preset.key;
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => onChange({ ...form, bannerPreset: preset.key })}
              data-testid={`home-config-banner-preset-${preset.key}`}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-card border p-2 text-11 transition-colors duration-fast",
                active ? "border-primary bg-accent" : "border-border-subtle hover:bg-muted",
              )}
            >
              <span className={cn("h-8 w-full rounded-control", preset.swatchClass)} />
              {preset.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function QuickActionsSection({
  form, onChange,
}: {
  form: FormState;
  onChange: (next: FormState) => void;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4">
      <h2 className="text-13 font-semibold text-card-foreground">快捷入口</h2>
      <p className="text-11 text-muted-foreground">勾选要在首页展示的入口，顺序固定为下列顺序。</p>
      <div className="flex flex-col gap-2">
        {QUICK_ACTION_META.map((meta) => (
          <Checkbox
            key={meta.key}
            label={meta.label}
            checked={form.quickActionEnabled[meta.key]}
            onChange={(e) => onChange({
              ...form,
              quickActionEnabled: { ...form.quickActionEnabled, [meta.key]: e.target.checked },
            })}
            data-testid={`home-config-quick-action-${meta.key}`}
          />
        ))}
      </div>
    </section>
  );
}

function RecommendedCapabilitiesSection({
  orgId, form, onChange,
}: {
  orgId: string | null;
  form: FormState;
  onChange: (next: FormState) => void;
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerState, setPickerState] = React.useState<"loading" | "ready" | "error">("loading");
  const [agents, setAgents] = React.useState<readonly AgentListRow[]>([]);
  const [skills, setSkills] = React.useState<readonly SkillListItem[]>([]);

  React.useEffect(() => {
    if (!pickerOpen || orgId === null) return;
    let cancelled = false;
    setPickerState("loading");
    Promise.all([
      listAgents({ publishState: "运行中" }),
      listSkills(orgId),
    ])
      .then(([agentRows, skillRows]) => {
        if (cancelled) return;
        setAgents(agentRows);
        setSkills(skillRows.filter((s) => s.status === "已启用"));
        setPickerState("ready");
      })
      .catch(() => { if (!cancelled) setPickerState("error"); });
    return () => { cancelled = true; };
  }, [pickerOpen, orgId]);

  const selectedKeys = new Set(form.recommendedCapabilities.map((c) => `${c.kind}-${c.refId}`));
  const atMax = form.recommendedCapabilities.length >= 6;

  function addCapability(next: RecommendedCapability) {
    if (atMax) return;
    onChange({ ...form, recommendedCapabilities: [...form.recommendedCapabilities, next] });
  }

  function removeCapability(kind: RecommendedCapability["kind"], refId: string) {
    onChange({
      ...form,
      recommendedCapabilities: form.recommendedCapabilities.filter((c) => !(c.kind === kind && c.refId === refId)),
    });
  }

  function updateNote(kind: RecommendedCapability["kind"], refId: string, note: string) {
    onChange({
      ...form,
      recommendedCapabilities: form.recommendedCapabilities.map((c) => (
        c.kind === kind && c.refId === refId ? { ...c, note: note.length > 0 ? note : null } : c
      )),
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-13 font-semibold text-card-foreground">组织推荐</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={atMax}
          data-testid="home-config-add-recommendation"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          添加推荐（最多 6 个）
        </Button>
      </div>

      {form.recommendedCapabilities.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {form.recommendedCapabilities.map((c) => (
            <li
              key={`${c.kind}-${c.refId}`}
              className="flex items-start gap-2 rounded-card border border-border-subtle bg-card p-2.5"
              data-testid={`home-config-recommendation-${c.kind}-${c.refId}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control bg-ai-tint text-ai">
                {c.kind === "agent" ? <Bot aria-hidden className="h-3.5 w-3.5" /> : <Sparkles aria-hidden className="h-3.5 w-3.5" />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-12 font-medium text-card-foreground">{c.name}</span>
                <Input
                  value={c.note ?? ""}
                  placeholder="备注（可选，最多 80 字）"
                  maxLength={80}
                  onChange={(e) => updateNote(c.kind, c.refId, e.target.value)}
                  data-testid={`home-config-recommendation-note-${c.kind}-${c.refId}`}
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => removeCapability(c.kind, c.refId)}
                aria-label={`移除 ${c.name}`}
                data-testid={`home-config-remove-${c.kind}-${c.refId}`}
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-11 text-muted-foreground">还没有推荐任何 Agent 或 Skill。</p>
      )}

      {pickerOpen ? (
        <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-card p-3" data-testid="home-config-picker">
          {pickerState === "loading" ? (
            <p className="text-11 text-muted-foreground">加载 Agent / Skill 目录…</p>
          ) : pickerState === "error" ? (
            <p className="text-11 text-destructive">目录加载失败，请稍后重试。</p>
          ) : (
            <>
              <PickerGroup
                title="Agent"
                emptyHint="本组织还没有已发布的 Agent。"
                rows={agents.map((a) => ({ id: a.agentId, name: a.name }))}
                kind="agent"
                selectedKeys={selectedKeys}
                disabled={atMax}
                onPick={(id, name) => addCapability({ kind: "agent", refId: id, name, note: null })}
              />
              <PickerGroup
                title="Skill"
                emptyHint="本组织还没有已启用的 Skill。"
                rows={skills.map((s) => ({ id: s.skillId, name: s.name }))}
                kind="skill"
                selectedKeys={selectedKeys}
                disabled={atMax}
                onPick={(id, name) => addCapability({ kind: "skill", refId: id, name, note: null })}
              />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function PickerGroup({
  title, emptyHint, rows, kind, selectedKeys, disabled, onPick,
}: {
  title: string;
  emptyHint: string;
  rows: ReadonlyArray<{ id: string; name: string }>;
  kind: RecommendedCapability["kind"];
  selectedKeys: Set<string>;
  disabled: boolean;
  onPick: (id: string, name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-11 font-medium text-muted-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-11 text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((row) => {
            const picked = selectedKeys.has(`${kind}-${row.id}`);
            return (
              <button
                key={row.id}
                type="button"
                disabled={picked || disabled}
                onClick={() => onPick(row.id, row.name)}
                data-testid={`home-config-picker-${kind}-${row.id}`}
                className="rounded-control border border-border-subtle bg-panel px-2 py-1 text-11 text-card-foreground transition-colors duration-fast hover:bg-muted disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground"
              >
                {picked ? `已添加 · ${row.name}` : row.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
