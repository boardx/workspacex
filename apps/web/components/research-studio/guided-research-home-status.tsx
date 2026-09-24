import { AlertTriangle, CheckCircle2, CircleDot, FileCheck2 } from "lucide-react";
import type { GuidedResearchSession } from "@/lib/guided-research-api";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const STAGE_PRESENTATION: Record<GuidedResearchSession["resumeStage"], {
  label: string;
  step: number;
  action: string;
}> = {
  brief: { label: "研究问题", step: 1, action: "完善研究问题" },
  directions: { label: "研究方向", step: 2, action: "确认研究方向" },
  outline: { label: "研究大纲", step: 3, action: "审阅研究大纲" },
  researching: { label: "资料取证", step: 4, action: "继续收集证据" },
  report: { label: "研究报告", step: 5, action: "审阅研究报告" },
};

export function guidedResearchHomePresentation(session: GuidedResearchSession) {
  const stage = STAGE_PRESENTATION[session.resumeStage];
  const completed = session.status === "completed";
  const failed = session.status === "failed";
  const evidenceRequired = session.resumeStage === "researching" || session.resumeStage === "report";
  // Zero sources is the normal start of `researching` while collection runs; only a report with no
  // sources is an evidence gap that needs attention (mod-user-research SKILL, issue #4026).
  const missingEvidence = session.resumeStage === "report" && session.sourceCount === 0;
  return {
    ...stage,
    action: completed ? "查看研究报告" : failed ? "恢复研究" : stage.action,
    attention: failed || missingEvidence,
    attentionLabel: missingEvidence ? "证据缺口" : failed ? "流程中断" : null,
    statusLabel: completed ? "已完成" : failed ? "需恢复" : stage.label,
    statusTone: completed ? "primary" as const : failed || missingEvidence ? "danger" as const : session.resumeStage === "researching" ? "warning" as const : "neutral" as const,
    evidenceLabel: missingEvidence
      ? "报告阶段尚无可用来源"
      : evidenceRequired && session.sourceCount === 0 ? "正在收集证据，尚无来源"
      : evidenceRequired || completed ? `${session.sourceCount} 个来源已进入证据链` : "完成研究设计后开始取证",
  };
}

export function GuidedResearchHomeSummary({ sessions }: { sessions: readonly GuidedResearchSession[] }) {
  const active = sessions.filter((session) => session.status !== "completed").length;
  const attention = sessions.filter((session) => guidedResearchHomePresentation(session).attention).length;
  const completed = sessions.filter((session) => session.status === "completed").length;
  const items = [
    { label: "进行中", value: active, icon: CircleDot },
    { label: "需要处理", value: attention, icon: AlertTriangle },
    { label: "已完成", value: completed, icon: CheckCircle2 },
  ];
  return <section data-testid="research-home-summary" aria-label="研究工作概览" className="grid gap-3 sm:grid-cols-3">
    {items.map(({ label, value, icon: Icon }) => <div key={label} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden /></span>
      <div><p className="text-11 text-muted-foreground">{label}</p><p className="text-18 font-semibold">{value}</p></div>
    </div>)}
  </section>;
}

export function GuidedResearchCardProgress({ session }: { session: GuidedResearchSession }) {
  const presentation = guidedResearchHomePresentation(session);
  const completed = session.status === "completed";
  return <div className="space-y-2" data-testid={`research-stage-${session.sessionId}`}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <FileCheck2 className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-12 font-medium">{presentation.label}</span>
      </div>
      <span className="text-11 text-muted-foreground">第 {presentation.step} / 5 步</span>
    </div>
    <Progress value={presentation.step} max={5} label={`研究流程：第 ${presentation.step} / 5 步，${presentation.label}`} tone={presentation.attention ? "destructive" : completed ? "primary" : "warning"} />
    <div className="flex items-center justify-between gap-3">
      <span className={presentation.attention ? "text-11 font-medium text-destructive" : "text-11 text-muted-foreground"}>{presentation.evidenceLabel}</span>
      {presentation.attentionLabel && <Badge tone="danger">{presentation.attentionLabel}</Badge>}
    </div>
  </div>;
}
