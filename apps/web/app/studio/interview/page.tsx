import { AppShell } from "@/components/shell/app-shell";
import { InterviewStudio } from "@/components/interview/interview-studio";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { resolveScope } from "@/lib/mock/interview-studio";

/**
 * Studio · 访谈 —— 列表与范围（UC-6.0）+ 访谈模板标签（UC-6.1）。
 *
 * 这是访谈 Studio 的落地屏：跨项目全部访谈的列表、范围切换器、两标签、筛选。
 * 「独立发起，不依赖项目」——打开某场进入 `/studio/interview/[id]` 的六标签详情
 * （研究设计 / 受访者 / 虚拟 / 专家推演 / 记录 / 洞察与报告）。
 *
 * 七态经 `?state=` 走完；范围经 `?scope=`；标签经 `?tab=interviews|templates`。
 */
export default function InterviewStudioPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string; scope?: string; tab?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const scopeId = resolveScope(searchParams.scope);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);
  const tab = searchParams.tab === "templates" ? "templates" : "interviews";

  return (
    <AppShell identity={identity} previewRole={previewRole}>
      <InterviewStudio state={state} scopeId={scopeId} tab={tab} />
    </AppShell>
  );
}
