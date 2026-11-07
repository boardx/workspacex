"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { Building2, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { fetchOrgKnowledge, knowledgeGraphErrorCode, type OrgKnowledge } from "@/lib/knowledge-graph-api";
import { Badge } from "@/components/ui/badge";
import { isScopeOpen } from "@/lib/brain-view";

const LAYERS: readonly { scope: "project" | "org"; label: MessageKey; what: MessageKey; icon: typeof Users }[] = [
  {
    scope: "project" as const,
    label: "brain.layer.project.label",
    icon: Users,
    what: "brain.layer.project.what",
  },
  {
    scope: "org" as const,
    label: "brain.layer.org.label",
    icon: Building2,
    what: "brain.layer.org.what",
  },
];

/**
 * 项目与组织两层的开放状态只看契约 `KG_SCOPES_ENABLED_PHASE_18`（项目中枢 R7 放开项目，B2-S4 #4428 放开组织）。
 * 没开放的如实写「尚未开放」，不摆示例数字、不演示台账；开放的只说怎么用，真实内容各自在项目大脑 / 组织大脑接口里。
 */
export function SharedLayers() {
  const { t } = useI18n();
  const [org, setOrg] = React.useState<OrgKnowledge | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "ready" | "failed" | "denied">("idle");
  async function openOrg() {
    setStatus("loading");
    try { setOrg(await fetchOrgKnowledge()); setStatus("ready"); }
    catch (e) { setStatus(knowledgeGraphErrorCode(e) === "KG_NOT_VISIBLE" ? "denied" : "failed"); }
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="brain-shared">
      {LAYERS.map((l) => {
        const open = isScopeOpen(l.scope);
        return (
          <div key={l.scope} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid={`brain-layer-${l.scope}`}>
            <div className="flex items-center gap-2">
              <l.icon aria-hidden className="h-4 w-4 text-muted-foreground" />
              <span className="text-13 font-medium">{t(l.label)}</span>
              <Badge tone="outline" className="ml-auto" data-testid={`brain-layer-${l.scope}-status`}>
                {open ? t("brain.layer.open") : t("brain.layer.closed")}
              </Badge>
            </div>
            <p className="text-12 text-muted-foreground">{t(l.what)}</p>
            {open && l.scope === "project" ? <Link href="/projects" className="text-12 text-primary underline">{t("brain.layer.project.view")}</Link> : null}
            {open && l.scope === "org" ? (
              <>
                <Button size="sm" variant="outline" disabled={status === "loading"} onClick={() => void openOrg()}>{t("brain.layer.org.view")}</Button>
                {status === "loading" ? <p role="status" className="text-12">{t("brain.layer.org.loading")}</p> : null}
                {status === "failed" ? <p role="alert" className="text-12">{t("brain.layer.org.failed")}</p> : null}
                {status === "denied" ? <p role="alert" className="text-12">{t("brain.layer.org.denied")}</p> : null}
                {status === "ready" && org ? (
                  <div data-testid="brain-org-content" className="flex flex-col gap-2 text-12">
                    {org.claims.length === 0 ? <p>{t("brain.layer.org.empty")}</p> : null}
                    {org.claims.map((c) => <p key={c.id}>{c.statement}</p>)}
                  </div>
                ) : null}
              </>
            ) : null}
            {!open ? (
              <p className="text-11 text-muted-foreground">
                {t("brain.layer.closedHint")}
              </p>
            ) : l.scope === "project" ? (
              <p className="text-11 text-muted-foreground" data-testid="brain-layer-project-hint">
                {t("brain.layer.project.hint")}
              </p>
            ) : (
              <p className="text-11 text-muted-foreground" data-testid="brain-layer-org-hint">
                {t("brain.layer.org.hint")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
