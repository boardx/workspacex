"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";
import { loadAidtDesignHandoff, type AidtDesignHandoff } from "../lib/aidt-design-handoff";
import { isAidtModuleEnabled } from "../lib/aidt-module-config";
import { previewAidtDesign } from "../lib/aidt-prototype-print-preview";
import { importAidtNativeSourceImages, requireAidtNativeSourceImages, type AidtSourceImportState } from "../lib/aidt-prototype-source-images";
import { listMyProjects } from "@/lib/live-design-workbench";
import { aidtIterationDesignPrompt, loadAidtIterationDesignContext } from "../lib/aidt-iteration-design-context";
import { loadAidtConfirmedPrototypeText } from "../lib/aidt-prototype-confirmed-text";

type Props = {
  projectId: string; teachingProjectId: string; stageId: number; lifecycleKey: string;
  prototypeEntityId?: string;
  sessionToken: string | null; returnRevision?: string | null; returnEntity?: string | null; onBack?: () => void; onNextDesign?: () => void;
};
/** A host adapter around the existing native Design composer, never a second chat UI. */
export function AidtDesignWorkspace(props: Props) {
  if (!isAidtModuleEnabled()) return null;
  const scope = JSON.stringify([props.projectId, props.teachingProjectId, props.stageId, props.lifecycleKey, props.sessionToken, props.returnRevision, props.returnEntity, props.prototypeEntityId]);
  return <ScopedWorkspace key={scope} {...props} />;
}
function ScopedWorkspace({ projectId, teachingProjectId, stageId, sessionToken, returnRevision, returnEntity, prototypeEntityId, onBack, onNextDesign }: Props) {
  const imageImport = React.useRef<AidtSourceImportState>({ pending: [], unknown: false });
  const [retry, setRetry] = React.useState(0);
  const [state, setState] = React.useState<{ handoff?: AidtDesignHandoff; learning?: string; error?: string } | null>(null);
  const printScope = JSON.stringify([projectId, teachingProjectId, stageId, sessionToken, prototypeEntityId, state?.handoff?.textBasis, state?.learning, state?.error, retry]);
  const currentPrintScope = React.useRef(printScope); currentPrintScope.current = printScope;
  React.useEffect(() => { currentPrintScope.current = printScope; return () => { currentPrintScope.current = "unmounted"; }; }, [printScope]);
  React.useEffect(() => {
    const controller = new AbortController();
    setState(null);
    if (!sessionToken) { setState({ error: "登录并选择组织后才能读取已保存制作说明。" }); return () => controller.abort(); }
    const roundRevision = stageId === 5 && returnEntity ? undefined : returnRevision == null ? undefined : /^[1-9]\d*$/.test(returnRevision) ? Number(returnRevision) : NaN;
    void loadAidtDesignHandoff({ projectId: teachingProjectId, stageId, sessionToken, roundRevision, prototypeEntityId, signal: controller.signal }).then(async handoff => {
      const learning = stageId === 5 && returnEntity ? await loadAidtIterationDesignContext({ projectId: teachingProjectId, designId: projectId, entityId: returnEntity, revision: returnRevision, sessionToken, signal: controller.signal }) : undefined;
      aidtIterationDesignPrompt(handoff.offer.text, learning);
      if (!controller.signal.aborted) setState(handoff.textBasis && handoff.textBasis.designId === projectId
        ? { handoff, learning } : { error: "请在本原型中保存并确认文字设计的确切修订，再继续制作；旧原型仍可查看。" });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const code = error instanceof Error ? error.message : "";
      setState({ error: code === "AIDT_PROTOTYPE_TEXT_CONFIRMATION_REQUIRED" || code === "AIDT_PROTOTYPE_TEXT_VERSION_MISMATCH" ? "请先保存并确认本原型文字设计的确切修订；当前未启动原型生成。" : code === "AIDT_PROTOTYPE_SOURCE_REVOKED" ? "研究材料文字授权已撤回或当前不可核对，暂不能继续制作。" : code === "AIDT_DESIGN_SAVED_QUESTION_REQUIRED" ? "先保存已确认的第5步问题卡；本轮测试请先保存带入的冻结问题。当前未启动原型生成。" : code === "AIDT_DESIGN_INPUTS_UNCONFIRMED" ? "请重新核对并保存本轮点子、验证问题和制作说明，再启动 Design 生成。" : code === "AIDT_DESIGN_RETURN_CONTEXT_INVALID" ? "这份历史学习记录尚未确认或没有选择返回第5步。请回第6步核对；当前只保留原型查看与编辑，未启动新生成。" : code === "AIDT_DESIGN_CONTEXT_TOO_LONG" ? "已保存制作说明超过原生Design的单条文字上限。请精简记录或分次人工整理；未截断原问题，也未启动生成。" : "已保存制作说明读取失败，未使用当前草稿或其他版本替代。请重试；原型仍可查看。" });
    });
    return () => controller.abort();
  }, [projectId, teachingProjectId, stageId, sessionToken, returnRevision, returnEntity, prototypeEntityId, retry]);
  React.useEffect(() => {
    const recheck = () => { setState(null); setRetry(value => value + 1); };
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, []);
  const blocked = !state ? "正在读取已保存的问题与制作说明，尚未启动生成。" : state.error;
  return <div className="flex min-h-0 flex-1 flex-col" data-testid="aidt-design-workspace">
    {(state?.error || state?.handoff?.warnings.length) ? <div className="space-y-2 border-b border-border px-4 py-3 text-12">
      {state.error && <><p role="alert" data-testid="err-design-handoff">{state.error}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => { setState(null); setRetry(value => value + 1); }}>重新读取已保存制作说明</Button></>}
      {state.handoff?.warnings.map(warning => <p key={warning} className="text-muted-foreground">{warning}</p>)}
    </div> : null}
    <DesignDetailScreen contained compactGeneration projectId={projectId} autoStart={false} requiredContextText={state?.handoff ? aidtIterationDesignPrompt(state.handoff.offer.text, state.learning) : ""}
      requiredContextId={state?.handoff ? state.learning ? JSON.stringify([state.handoff.offer.id, state.learning]) : state.handoff.offer.id : ""} sendBlockedReason={blocked} onBack={onBack} onNextDesign={onNextDesign}
      beforeSend={async (signal, native) => {
        const expected = state?.handoff;
        if (!sessionToken || !expected?.textBasis) throw new Error("AIDT_PROTOTYPE_TEXT_CONFIRMATION_REQUIRED");
        const roundRevision = stageId === 5 && returnEntity ? undefined : returnRevision == null ? undefined : /^[1-9]\d*$/.test(returnRevision) ? Number(returnRevision) : NaN;
        const actual = await loadAidtDesignHandoff({ projectId: teachingProjectId, stageId, sessionToken, roundRevision, prototypeEntityId, signal });
        if (signal.aborted || actual.offer.id !== expected.offer.id || actual.offer.text !== expected.offer.text
          || actual.textBasis?.textSha256 !== expected.textBasis.textSha256) throw new Error("AIDT_CONTEXT_CHANGED");
        const learning = stageId === 5 && returnEntity ? await loadAidtIterationDesignContext({ projectId: teachingProjectId, designId: projectId, entityId: returnEntity, revision: returnRevision, sessionToken, signal }) : undefined;
        if (learning !== state?.learning || signal.aborted) throw new Error("AIDT_CONTEXT_CHANGED");
        const input = { projectId: teachingProjectId, stageId, sessionToken, prototypeEntityId, roundRevision, signal };
        const currentPrototype = stageId === 5 && roundRevision === undefined;
        if (currentPrototype) await importAidtNativeSourceImages(input, actual, projectId, imageImport.current, () => signal.throwIfAborted());
        const freshNative = (await listMyProjects()).items.find(item => item.id === projectId);
        if (!native || !freshNative || signal.aborted || (!currentPrototype && JSON.stringify(native.refImages) !== JSON.stringify(freshNative.refImages)))
          throw new Error("原生参考图已变化，请重新读取后发送。");
        const latest = currentPrototype ? await loadAidtDesignHandoff(input) : actual;
        if (latest.offer.id !== actual.offer.id || latest.offer.text !== actual.offer.text
          || JSON.stringify(latest.sourceImages) !== JSON.stringify(actual.sourceImages)) throw new Error("AIDT_CONTEXT_CHANGED");
        const sourceIds = await requireAidtNativeSourceImages(input, latest, freshNative);
        return { ...freshNative, refImages: freshNative.refImages.filter(image => sourceIds.includes(image.id)) };
      }}
      printPreview={async project => {
        const identity = currentPrintScope.current;
        const basis = state?.handoff?.textBasis;
        if (!sessionToken || !basis || basis.designId !== projectId || project.id !== projectId) throw new Error("AIDT_CONTEXT_CHANGED");
        const allowed = await loadAidtConfirmedPrototypeText({ projectId: teachingProjectId, designId: projectId, sessionToken });
        if (allowed.confirmation.stageRevision !== basis.stageRevision || allowed.hashes.textSha256 !== basis.textSha256 || currentPrintScope.current !== identity) throw new Error("AIDT_CONTEXT_CHANGED");
        return previewAidtDesign(project, `原生 Design · ${project.name}`, { isCurrent: () => currentPrintScope.current === identity });
      }} />
  </div>;
}
