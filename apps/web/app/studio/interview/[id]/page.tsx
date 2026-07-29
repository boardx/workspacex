import { AppShell } from "@/components/shell/app-shell";
import { InterviewDetail } from "@/components/interview/interview-detail";
import { InterviewOutline } from "@/components/interview/interview-outline";
import { InterviewCopilot } from "@/components/interview/interview-copilot";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { resolveInterviewView } from "@/lib/mock/interview";
import { resolveDetailTab } from "@/lib/mock/interview-studio";

/**
 * 访谈详情 · 六标签（UC-6.0 R8）。
 *   研究设计(UC-6.2) ｜ 受访者(UC-6.3/6.7) ｜ 虚拟 ｜ 专家推演 ｜ 记录(UC-6.4/5.x) ｜ 洞察与报告(UC-6.5)
 *
 * 只有「记录」标签是三栏（左提纲 / 中转录 / 右副驾驶），故 AppShell 的左右栏
 * 仅在 `tab=record` 且非受访者视角时挂载；其余标签是单栏。
 * tab 经 `?tab=`；七态经 `?state=`；角色视角经 `?view=`。
 *
 * `/studio/interview/new` 也命中本路由（id="new"）——回显新建向导已完成的研究设计，
 * 与 `[用它新建]` / `[＋ 新建访谈]` 的落点一致。
 */
export default function InterviewDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { state?: string; as?: string; org?: string; view?: string; tab?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const view = resolveInterviewView(searchParams.view);
  const tab = resolveDetailTab(searchParams.tab);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  const recordThreeCol = tab === "record" && view !== "interviewee";

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={recordThreeCol ? <InterviewOutline /> : undefined}
      right={recordThreeCol ? <InterviewCopilot view={view} /> : undefined}
    >
      <InterviewDetail id={params.id} tab={tab} state={state} view={view} />
    </AppShell>
  );
}
