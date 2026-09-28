"use client";
import * as React from "react";
import { project as C } from "@repo/contracts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { SectionTitle } from "./parts";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import {
  getProjectAiSettings, updateProjectAiSettings,
  type ProjectAiSettings, type ProjectAiSourceKind,
} from "@/lib/live-project-ai-settings";

/**
 * 「AI 权限」面板（项目中枢 B2-S5，#4429）——哪些来源允许进入项目大脑，落库在 `project_ai_settings`。
 *
 * 读：`getProjectAiSettings`（所有项目成员）；没有行 ⇒ 服务端回全集 + `updatedAt: null`，界面如实说「尚未设置过（默认全部允许）」。
 * 写（`canEdit`）：五个开关 + 保存，整体替换；服务端判定 `authorizeManageMembers`（引导师，或组织 lead / admin），越权 403 如实显示。
 * 不可编辑的视角只看徽标，不给开关。每次保存成功后以服务端回显为准，不在本地凭空标「已保存」。
 */
const SOURCES: readonly ProjectAiSourceKind[] = C.ProjectAiSourceKind.options;

export function ProjectAiSettingsPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [settings, setSettings] = React.useState<ProjectAiSettings | undefined>(undefined);
  const [draft, setDraft] = React.useState<ReadonlySet<ProjectAiSourceKind>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    getProjectAiSettings(projectId)
      .then((out) => {
        if (cancelled) return;
        setSettings(out);
        setDraft(new Set(out.allowedSources));
      })
      .catch((e: unknown) => { if (!cancelled) setError(describeFailure(e)); });
    return () => { cancelled = true; };
  }, [projectId]);

  const dirty = settings !== undefined && !sameSet(draft, settings.allowedSources);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      const out = await updateProjectAiSettings({
        projectId,
        allowedSources: SOURCES.filter((k) => draft.has(k)),
      });
      setSettings(out);
      setDraft(new Set(out.allowedSources));
      setSaved(true);
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="project-ai-settings">
      <SectionTitle meta="哪些来源允许进入项目大脑（项目记忆只从这些来源生长）">AI 权限</SectionTitle>
      <Card>
        {settings === undefined && error === null && (
          <p className="p-4 text-11 text-muted-foreground">加载中…</p>
        )}
        {settings !== undefined && (
          <ul className="divide-y divide-border">
            {SOURCES.map((kind) => {
              const on = draft.has(kind);
              return (
                <li key={kind} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-12 text-foreground">{C.PROJECT_AI_SOURCE_LABEL_ZH[kind]}</span>
                  {canEdit ? (
                    <Toggle
                      data-testid={`project-ai-source-${kind}`}
                      checked={on}
                      disabled={busy}
                      label={C.PROJECT_AI_SOURCE_LABEL_ZH[kind]}
                      onCheckedChange={(v) => {
                        setSaved(false);
                        setDraft((prev) => { const next = new Set(prev); if (v) next.add(kind); else next.delete(kind); return next; });
                      }}
                    />
                  ) : (
                    <Badge tone={on ? "success" : "outline"} data-testid={`project-ai-source-${kind}`} data-allowed={on ? "true" : "false"}>
                      {on ? "允许" : "不允许"}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {settings !== undefined && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
            <span className="text-11 text-muted-foreground" data-testid="project-ai-settings-meta">
              {settings.updatedAt === null
                ? "尚未设置过（默认全部允许）"
                : `最近由 ${settings.updatedBy ?? "—"} 于 ${new Date(settings.updatedAt).toLocaleString("zh-CN")} 更新`}
            </span>
            {canEdit ? (
              <span className="flex items-center gap-2">
                {saved && !dirty && <span className="text-11 text-success" data-testid="project-ai-settings-saved">已保存</span>}
                <Button size="sm" data-testid="project-ai-settings-save" disabled={!dirty || busy} onClick={() => void save()}>
                  {busy ? "保存中…" : "保存"}
                </Button>
              </span>
            ) : (
              <span className="text-11 text-muted-foreground">只有本项目的引导师（或组织负责人 / 管理员）能修改。</span>
            )}
          </div>
        )}
        {error !== null && (
          <p className="border-t border-border px-4 py-2.5 text-11 text-destructive" data-testid="project-ai-settings-error">{error}</p>
        )}
      </Card>
    </section>
  );
}

function sameSet(a: ReadonlySet<ProjectAiSourceKind>, b: readonly ProjectAiSourceKind[]): boolean {
  return a.size === b.length && b.every((k) => a.has(k));
}

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.reasonCode) {
      case "NO_PROJECT_ROLE": return "你不在这个项目里，看不到它的 AI 权限。";
      case "ADMIN_NOT_SUPERUSER": return "组织管理员不自动拥有项目内容的读权限，需要先被加入项目。";
      case "PROJECT_ROLE_INSUFFICIENT": return "只有本项目的引导师（或组织负责人 / 管理员）能修改 AI 权限。";
      case "ORG_ROLE_INSUFFICIENT": return "你的组织角色不足以修改这个项目的 AI 权限。";
      case "AUTH_SERVICE_UNAVAILABLE": return "身份校验服务暂时不可用，请稍后重试。";
    }
    return httpFailureText(e.status);
  }
  return e instanceof Error ? e.message : "操作失败，请稍后重试。";
}
