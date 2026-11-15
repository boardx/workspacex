"use client";
import { useSearchParams } from "next/navigation";
import { isAidtModuleEnabled } from "@/lib/aidt-module-config";
import { aidtHref, AIDT_STEPS } from "@/lib/project-aidt";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { projectResearchHref, type ProjectResearchSub } from "./project-links";
export { projectResearchHref, withProjectId } from "./project-links";
export type { ProjectResearchSub } from "./project-links";

/**
 * 项目 ⇄ Studio 往返的面包屑（项目中枢 B2-S2）。
 *
 * 各 Studio（问卷 / 深度研究 / 录音转写 / 用户访谈）从项目子导航带着 `?projectId=` 进来时，
 * 顶部挂这一条「← 返回项目」，链回 `/projects/<id>?tab=research&sub=<kind>`——
 * 没有 `projectId` 的独立 Studio 访问不渲染任何东西（调用方直接传 `null` 即可）。
 */
export function ProjectBreadcrumb({ projectId, sub, className, hrefOverride, labelOverride }: {
  projectId: string | null | undefined; sub: ProjectResearchSub; className?: string;
  /** Trusted caller-supplied navigation. Does not authorize access to the target. */
  hrefOverride?: string; labelOverride?: string;
}) {
  const { t } = useI18n();
  const search = useSearchParams();
  const aidtStep = isAidtModuleEnabled() ? search.get("aidtStep") : null;
  const step = aidtStep ? AIDT_STEPS.find((it) => String(it.id) === aidtStep) : undefined;
  if (!projectId) return null;
  const label = labelOverride ?? (step ? "返回 AIDT 步骤" : t("workflows.back"));
  return (
    <nav aria-label={label} className={className ?? "px-5 pt-4 md:px-8 lg:px-10"} data-testid="project-breadcrumb">
      <a
        href={hrefOverride ?? (step ? aidtHref(projectId, step.id, { tool: sub, thread: search.get("aidtThread") ?? search.get("thread") }) : projectResearchHref(projectId, sub))}
        data-testid="project-breadcrumb-back"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-12 text-muted-foreground transition-colors hover:bg-muted hover:text-background-foreground"
      >
        <ArrowLeft aria-hidden className="h-3.5 w-3.5" />{label}
      </a>
    </nav>
  );
}
