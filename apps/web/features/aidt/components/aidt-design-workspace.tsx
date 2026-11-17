"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";
import { loadAidtDesignHandoff, type AidtDesignHandoff } from "../lib/aidt-design-handoff";
import { isAidtModuleEnabled } from "../lib/aidt-module-config";

type Props = {
  projectId: string; teachingProjectId: string; stageId: number; lifecycleKey: string;
  sessionToken: string | null; returnRevision?: string | null; onBack?: () => void; onNextDesign?: () => void;
};
/** A host adapter around the existing native Design composer, never a second chat UI. */
export function AidtDesignWorkspace(props: Props) {
  if (!isAidtModuleEnabled()) return null;
  const scope = JSON.stringify([props.projectId, props.teachingProjectId, props.stageId, props.lifecycleKey, props.sessionToken, props.returnRevision]);
  return <ScopedWorkspace key={scope} {...props} />;
}
function ScopedWorkspace({ projectId, teachingProjectId, stageId, sessionToken, returnRevision, onBack, onNextDesign }: Props) {
  const [retry, setRetry] = React.useState(0);
  const [state, setState] = React.useState<{ handoff?: AidtDesignHandoff; error?: string } | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    setState(null);
    if (!sessionToken) { setState({ error: "登录并选择组织后才能读取已保存制作说明。" }); return () => controller.abort(); }
    const roundRevision = returnRevision == null ? undefined : /^[1-9]\d*$/.test(returnRevision) ? Number(returnRevision) : NaN;
    void loadAidtDesignHandoff({ projectId: teachingProjectId, stageId, sessionToken, roundRevision, signal: controller.signal }).then(handoff => {
      if (!controller.signal.aborted) setState({ handoff });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const code = error instanceof Error ? error.message : "";
      setState({ error: code === "AIDT_DESIGN_SAVED_QUESTION_REQUIRED" ? "先保存已确认的第5步问题卡；本轮测试请先保存带入的冻结问题。当前未启动原型生成。" : code === "AIDT_DESIGN_RETURN_CONTEXT_INVALID" ? "这份历史学习记录尚未确认或没有选择返回第5步。请回第6步核对；当前只保留原型查看与编辑，未启动新生成。" : code === "AIDT_DESIGN_CONTEXT_TOO_LONG" ? "已保存制作说明超过原生Design的单条文字上限。请精简记录或分次人工整理；未截断原问题，也未启动生成。" : "已保存制作说明读取失败，未使用当前草稿或其他版本替代。请重试；原型仍可查看。" });
    });
    return () => controller.abort();
  }, [projectId, teachingProjectId, stageId, sessionToken, returnRevision, retry]);
  const blocked = !state ? "正在读取已保存的问题与制作说明，尚未启动生成。" : state.error;
  return <div className="flex min-h-0 flex-1 flex-col" data-testid="aidt-design-workspace">
    <div className="space-y-2 border-b border-border px-4 py-3 text-12">
      <p>教学内容只会在你点击带入后填写原生Design输入框；审阅并发送才调用模型。保存、生成与版本选择分别处理。</p>
      {state?.error ? <p role="alert" data-testid="err-design-handoff">{state.error}</p> : !state ? <p role="status" data-testid="loading">正在读取制作说明…</p> : <p role="status">待审阅来源：{state.handoff?.sources.map(source => `第${source.stageId}步 V${source.revision}`).join("、")}</p>}
      {state?.handoff?.warnings.map(warning => <p key={warning} className="text-muted-foreground">{warning}</p>)}
      <Button type="button" size="sm" variant="outline" onClick={() => { setState(null); setRetry(value => value + 1); }}>重新读取已保存制作说明</Button>
    </div>
    <DesignDetailScreen projectId={projectId} autoStart={false} composerContextOffer={state?.handoff?.offer} sendBlockedReason={blocked} onBack={onBack} onNextDesign={onNextDesign} />
  </div>;
}
