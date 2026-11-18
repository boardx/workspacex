"use client";
import { localizeBlueprintCopy } from "@/lib/i18n/blueprint-copy";
import { useI18n } from "@/lib/i18n/provider";

import * as React from "react";
import { CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PROJECT_SIDE_UNKNOWNS } from "@/lib/mock/tpl";

/**
 * 项目侧缺失概念 —— UC-2.2「套用蓝本新建项目」是项目**唯一出生路径**，
 * 而「项目」这个域的需求刚被发现缺失（另有 agent 在起草 requirements/00-project/）。
 * 我需要但不存在的概念在此**显式列出，不替它编**（任务硬约束）。
 * 依据：requirements/00-project/DERIVED-FROM-CONTRACTS.md
 */
export function ProjectSideGaps() {
 const { t: blueprintI18n } = useI18n();

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3" data-testid="tpl-project-gaps">
      <div className="flex items-center gap-2">
        <CircleAlert aria-hidden className="h-4 w-4 text-warning" />
        <h3 className="text-13 font-semibold">{blueprintI18n("blueprintFlow.conceptsNeededHereButNotYetDefinedByTheProject")}</h3>
        <Badge tone="warning" className="ml-auto">{blueprintI18n("blueprintFlow.highRiskIntersection")}</Badge>
      </div>
      <p className="text-11 text-muted-foreground">{blueprintI18n("blueprintFlow.blueprintApplicationIsTheOnlyProjectCreationPathButMissing")}</p>
      <ul className="flex flex-col gap-1.5">
        {PROJECT_SIDE_UNKNOWNS.map((u) => (
          <li key={u.q} className="flex flex-col gap-0.5 rounded-md border border-border bg-card p-2" data-testid="tpl-project-gap">
            <div className="flex items-center gap-2">
              <span className="text-12 font-medium">{localizeBlueprintCopy(blueprintI18n, u.q)}</span>
              <Badge tone="outline" className="ml-auto">{localizeBlueprintCopy(blueprintI18n, u.state)}</Badge>
            </div>
            <p className="text-10 leading-relaxed text-muted-foreground">{localizeBlueprintCopy(blueprintI18n, u.note)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
