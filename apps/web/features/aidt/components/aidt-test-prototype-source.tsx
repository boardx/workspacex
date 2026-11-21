"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { projectResourceHref } from "@/components/project/project-resource-section";
import { listAidtStageHistory } from "../lib/live-aidt-stages";
import { resolveAidtPrototypeVersion, type AidtPrototypeReadContext, type AidtPrototypeVersionReference } from "../lib/aidt-prototype-versions";
import { aidtPrototypeVersionLabel } from "../lib/aidt-prototype-label";
import { createAidtQuestionSnapshot, type AidtQuestionSnapshot } from "../lib/aidt-verification-loop";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import type { AidtTestGroup } from "../lib/aidt-test-groups";

export type AidtReadPrototypeEntity = (draft: AidtUiStageDraft, id: string) => AidtUiStageDraft | null;
export async function readAidtTestPrototypeStage(projectId: string, revision: number, sessionToken: string, signal: AbortSignal) {
  const { items } = await listAidtStageHistory(projectId, 5, sessionToken, { beforeRevision: revision + 1, limit: 1 }, signal);
  return items.find(item => item.revision === revision)?.content.draft;
}

export function AidtTestPrototypeSource({ group, context, readPrototypeEntity }: {
  group: AidtTestGroup;
  context: AidtPrototypeReadContext;
  readPrototypeEntity?: AidtReadPrototypeEntity;
}) {
  const { projectId, sessionToken, userId } = context;
  const { stage5Revision, prototypeEntity, designId, versionId } = group;
  const [open, setOpen] = React.useState(false);
  const [snapshot, setSnapshot] = React.useState<AidtQuestionSnapshot | "failed" | null>(null);
  const [prototype, setPrototype] = React.useState<AidtPrototypeVersionReference | "failed" | null>();
  const [retry, refresh] = React.useReducer((value: number) => value + 1, 0);
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSnapshot(null);
    setPrototype(null);
    void readAidtTestPrototypeStage(projectId, stage5Revision, sessionToken, controller.signal).then(stage => {
      if (controller.signal.aborted) return;
      const source = stage && (prototypeEntity ? readPrototypeEntity?.(stage, prototypeEntity) : stage);
      const result = source && createAidtQuestionSnapshot(source, stage5Revision);
      const exact = result && result.ok && result.snapshot.prototypeDesignId === designId && result.snapshot.prototypeVersionId === versionId;
      setSnapshot(exact ? result.snapshot : "failed");
    }).catch(() => { if (!controller.signal.aborted) setSnapshot("failed"); });
    void resolveAidtPrototypeVersion({ projectId, sessionToken, userId, signal: controller.signal }, designId, versionId).then(reference => {
      if (!controller.signal.aborted) setPrototype(reference);
    }, () => { if (!controller.signal.aborted) setPrototype("failed"); });
    return () => controller.abort();
  }, [projectId, sessionToken, userId, open, readPrototypeEntity, stage5Revision, prototypeEntity, designId, versionId, retry]);

  return <div className="space-y-2">
    <p className="break-all text-12">第 5 步 V{stage5Revision} · Design {designId} · 版本 {versionId}</p>
    <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "收起被测原型依据" : "查看被测原型依据"}</Button>
    {open && <div className="space-y-2 text-12">
      {snapshot === null ? <p role="status">正在读取第 5 步已保存的问题卡…</p>
        : snapshot === "failed" ? <p role="alert">无法核对这个历史问题卡，已保留测试的原引用。</p>
        : <dl className="space-y-1"><dt className="font-semibold">原验证问题</dt><dd>{snapshot.question}</dd><dt className="font-semibold">测试前看法</dt><dd>{snapshot.beforeTestBelief || "未记录"}</dd><dt className="font-semibold">验证范围</dt><dd>{snapshot.verificationLimits || "未记录"}</dd></dl>}
      {prototype === null ? <p role="status">正在核对 Design 历史版本…</p>
        : prototype === "failed" ? <p role="alert">当前无法读取该 Design 历史版本。</p>
        : prototype && <p>{aidtPrototypeVersionLabel(prototype)} · {prototype.generatedFrameCount} 页已生成。 <Link className="text-primary underline" href={projectResourceHref("design", designId, projectId)}>进入 Design 查看对应历史版本</Link></p>}
      {(snapshot === "failed" || prototype === "failed") && <Button type="button" variant="outline" size="xs" onClick={refresh}>重试核对</Button>}
    </div>}
  </div>;
}
