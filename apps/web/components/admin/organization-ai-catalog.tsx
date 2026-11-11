"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "./admin-nav";
import { AgentScreen } from "./agent-screen";
import { CapabilityCatalogScreen } from "./capability-catalog-screen";
import { PublicAiCatalog } from "./public-ai-catalog";
import { AgentDirectoryWorkspace } from "@/components/agent/agent-directory-workspace";
import { SkillCatalogLive } from "@/components/skill/skill-catalog-live";
import { WorkSkillCatalog } from "@/components/skill/work-skill-catalog";
import { useSession } from "@/components/session/session-provider";
import { useI18n } from "@/lib/i18n/provider";
import { agentChatHref } from "@/lib/agent-directory";
import type { AiCatalogKind } from "@/lib/ai-catalog-admin";
import { Button } from "@/components/ui/button";

type View = "organization" | "public" | "manage" | "catalog" | "work-catalog";
export function OrganizationAiCatalog({
  kind,
  initialScreen,
  standalone = false,
}: {
  kind: AiCatalogKind;
  initialScreen?: string;
  standalone?: boolean;
}) {
  const { session, identity } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const initial: View =
    initialScreen === "catalog"
      ? "catalog"
      : initialScreen === "work-catalog"
        ? "work-catalog"
        : initialScreen === "public"
          ? "public"
          : initialScreen === "manage" && kind === "agent" ? "manage" : "organization";
  const [view, setView] = React.useState<View>(initial);
  React.useEffect(()=>setView(initial),[initial]);
  const canManage = !standalone && identity?.orgRole === "admin";
  const active = view === "manage" && !canManage ? "organization" : view;
  const tabs: { id: View; label: string }[] = [
    { id: "organization", label: t("aiCatalog.organization") },
    { id: "public", label: t("aiCatalog.public") },
    ...(kind === "agent"
      ? canManage
        ? [{ id: "manage" as const, label: t("aiCatalog.manage") }]
        : []
      : [
          { id: "catalog" as const, label: t("aiCatalog.directory") },
          { id: "work-catalog" as const, label: t("aiCatalog.workSkills") },
        ]),
  ];
  return (
    <AppShell
      previewRole={null}
      left={standalone ? undefined : (
        <AdminNav
          active={kind === "agent" ? "org-agent" : "org-skill"}
          scope="org"
        />
      )}
    >
      <div
        className="mx-auto w-full max-w-screen-2xl space-y-5 p-4 md:p-6"
        key={`${session?.currentOrgId}:${session?.userId}:${kind}`}
      >
        <div
          className="flex flex-wrap gap-2"
          aria-label={t(
            kind === "agent" ? "aiCatalog.agentTitle" : "aiCatalog.skillTitle",
          )}
        >
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              variant={active === tab.id ? "primary" : "outline"}
              onClick={()=>{setView(tab.id);const query=new URLSearchParams(window.location.search);query.set("screen",tab.id === "organization" ? "library" : tab.id);router.replace(`${standalone ? "" : "/org-admin"}/${kind}?${query}`,{scroll:false});}}
              aria-pressed={active === tab.id}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        {active === "public" ? (
          <PublicAiCatalog kind={kind} />
        ) : kind === "agent" ? (
          active === "manage" ? (
            <AgentScreen state="default" />
          ) : (
            <AgentDirectoryWorkspace
              onStartChat={(id, prefill) =>
                router.push(agentChatHref(id, prefill))
              }
            />
          )
        ) : active === "catalog" ? (
          <CapabilityCatalogScreen kind="skill" />
        ) : active === "work-catalog" ? (
          <WorkSkillCatalog />
        ) : (
          <SkillCatalogLive />
        )}
      </div>
    </AppShell>
  );
}
