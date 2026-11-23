"use client";

import * as React from "react";
import Link from "next/link";
import { readAidtPrototypeEntityDraft } from "../lib/aidt-prototype-handoff";
import { readAidtPrototypeTextOutputBinding, readAidtPrototypeTextOutputBindings } from "../lib/aidt-prototype-text-state";
import { Button } from "@/components/ui/button";
import { projectResourceHref } from "@/components/project/project-resource-section";
import { listAidtStageHistory } from "../lib/live-aidt-stages";
import { loadAidtPrototypeSnapshot, type AidtPrototypeReadContext } from "../lib/aidt-prototype-versions";
import { AidtTestPrototypePreview } from "./aidt-test-prototype-preview";
import { previewAidtPrototype } from "../lib/aidt-prototype-print-preview";
import { createAidtQuestionSnapshot, type AidtQuestionSnapshot } from "../lib/aidt-verification-loop";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import type { AidtTestGroup } from "../lib/aidt-test-groups";

export type AidtReadPrototypeEntity = (draft: AidtUiStageDraft, id: string) => AidtUiStageDraft | null;
export async function readAidtTestPrototypeStage(projectId: string, revision: number, sessionToken: string, signal: AbortSignal) {
  const { items } = await listAidtStageHistory(projectId, 5, sessionToken, { beforeRevision: revision + 1, limit: 1 }, signal);
  return items.find(item => item.revision === revision)?.content.draft;
}

export function AidtTestPrototypeSource({ group, context, readPrototypeEntity, showQuestion = false, initiallyOpen = false }: {
  group: AidtTestGroup;
  context: AidtPrototypeReadContext;
  readPrototypeEntity?: AidtReadPrototypeEntity;
  showQuestion?: boolean;
  initiallyOpen?: boolean;
}) {
  const { projectId, sessionToken, userId } = context;
  const { stage5Revision, prototypeEntity, designId, versionId } = group;
  const [open, setOpen] = React.useState(initiallyOpen);
  const sourceScope = JSON.stringify([projectId, sessionToken, userId, stage5Revision, prototypeEntity, designId, versionId]);
  const [textBinding, setTextBinding] = React.useState<{ scope: string; revision: number } | null>(null);
  const [snapshot, setSnapshot] = React.useState<AidtQuestionSnapshot | "failed" | null>(null);
  const [prototype, setPrototype] = React.useState<Awaited<ReturnType<typeof loadAidtPrototypeSnapshot>> | "failed" | null>();
  const [retry, refresh] = React.useReducer((value: number) => value + 1, 0);
  const [printing, setPrinting] = React.useState(false);
  const [printError, setPrintError] = React.useState("");
  const printScope = JSON.stringify([projectId, sessionToken, userId, stage5Revision, prototypeEntity, designId, versionId, open, retry]);
  const latestPrintScope = React.useRef(printScope); latestPrintScope.current = printScope;
  React.useEffect(() => () => { latestPrintScope.current = ""; }, []);
  async function printPrototype() {
    if (!prototype || prototype === "failed" || printing) return;
    const expected = printScope, selected = prototype;
    setPrinting(true); setPrintError("");
    try {
      const actual = await loadAidtPrototypeSnapshot({ projectId, sessionToken, userId }, designId, versionId, "linked-reader");
      if (latestPrintScope.current !== expected || JSON.stringify(actual) !== JSON.stringify(selected)) throw new Error("SOURCE_CHANGED");
      await previewAidtPrototype(actual, `被测原型 · ${versionId}`, { defaultPaper: "A3", isCurrent: () => latestPrintScope.current === expected });
    } catch { if (latestPrintScope.current === expected) setPrintError("原型版本或访问权限无法核对，未打开打印预览。"); }
    finally { setPrinting(false); }
  }
  React.useEffect(() => {
    if (!open && !showQuestion) return;
    const controller = new AbortController();
    setSnapshot(null);
    setPrototype(null); setTextBinding(null);
    void readAidtTestPrototypeStage(projectId, stage5Revision, sessionToken, controller.signal).then(stage => {
      if (controller.signal.aborted) return;
      const source = stage && (prototypeEntity ? (readPrototypeEntity ?? readAidtPrototypeEntityDraft)(stage, prototypeEntity) : stage);
      const result = source && createAidtQuestionSnapshot(source, stage5Revision);
      const exact = result && result.ok && result.snapshot.prototypeDesignId === designId && result.snapshot.prototypeVersionId === versionId;
      setSnapshot(exact ? result.snapshot : "failed");
      const binding = exact && source && [readAidtPrototypeTextOutputBinding(source), ...readAidtPrototypeTextOutputBindings(source)].find(item => item && item.projectId === projectId && item.designId === designId && item.versionId === versionId && item.textStageRevision <= stage5Revision);
      setTextBinding(binding ? { scope: sourceScope, revision: binding.textStageRevision } : null);
    }).catch(() => { if (!controller.signal.aborted) setSnapshot("failed"); });
    if (open) void loadAidtPrototypeSnapshot({ projectId, sessionToken, userId, signal: controller.signal }, designId, versionId, "linked-reader").then(reference => {
      if (!controller.signal.aborted) setPrototype(reference);
    }, () => { if (!controller.signal.aborted) setPrototype("failed"); });
    return () => controller.abort();
  }, [projectId, sessionToken, userId, open, readPrototypeEntity, stage5Revision, prototypeEntity, designId, versionId, retry, showQuestion, sourceScope]);

  return <div className="space-y-2">
    <p className="break-all text-12">第 5 步 V{stage5Revision}{(!showQuestion || open) && ` · Design ${designId} · 版本 ${versionId}`}</p>
    <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "收起被测原型依据" : "查看被测原型依据"}</Button>
    {(open || showQuestion) && <div className="space-y-2 text-12">
      {snapshot === null ? <p role="status">正在读取第 5 步已保存的问题卡…</p>
        : snapshot === "failed" ? <p role="alert">无法核对这个历史问题卡，已保留测试的原引用。</p>
        : <dl className="space-y-1"><dt className="font-semibold">原验证问题</dt><dd>{snapshot.question}</dd><dt className="font-semibold">测试前看法</dt><dd>{snapshot.beforeTestBelief || "未记录"}</dd>{snapshot.verificationBasis && <><dt className="font-semibold">测试前依据</dt><dd>{snapshot.verificationBasis}</dd></>}<dt className="font-semibold">验证范围</dt><dd>{snapshot.verificationLimits || "未记录"}</dd></dl>}
      {textBinding?.scope === sourceScope && <Link className="text-primary underline" href={`/aidt/${encodeURIComponent(projectId)}?${new URLSearchParams({ step: "5", entity: designId, textRevision: String(textBinding.revision) })}`}>查看文字设计 V{textBinding.revision}</Link>}
      {open && (prototype === null ? <p role="status">正在核对 Design 历史版本…</p>
        : prototype === "failed" ? <p role="alert">当前无法读取该 Design 历史版本。</p>
        : prototype && <><AidtTestPrototypePreview key={prototype.id} snapshot={prototype} /><div className="flex flex-wrap gap-3"><Button type="button" size="sm" variant="outline" disabled={printing} onClick={() => void printPrototype()}>{printing ? "核对原型版本…" : "预览与打印全部原型页面"}</Button><Link className="text-primary underline" href={projectResourceHref("design", designId, projectId)}>进入 Design 查看对应历史版本</Link></div>{printError && <p role="alert">{printError}</p>}</>)}
      {(snapshot === "failed" || prototype === "failed") && <Button type="button" variant="outline" size="xs" onClick={refresh}>重试核对</Button>}
    </div>}
  </div>;
}
