"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtTestPrototypePreview } from "./aidt-test-prototype-preview";
import { loadAidtPrototypeSnapshot } from "../lib/aidt-prototype-versions";
import { readAidtPrototypeReference } from "../lib/aidt-prototype-reference";
import { loadAidtConfirmedPrototypeText, loadAidtBoundPrototypeTextSources } from "../lib/aidt-prototype-confirmed-text";
import { bindAidtPrototypeTextOutput, isAidtPrototypeTextConfirmed, readAidtPrototypeTextConfirmation, readAidtPrototypeTextOutputBindings } from "../lib/aidt-prototype-text-state";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";
import { previewAidtPrototype } from "../lib/aidt-prototype-print-preview";

type Snapshot = Awaited<ReturnType<typeof loadAidtPrototypeSnapshot>>;
type Props = { projectId: string; designId: string; draft: AidtUiStageDraft; matchesServer: boolean; readOnly: boolean;
  onBind: (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => void };

/** Explicit student/application association. The native version is real and
 * authorized; this relation never asserts a provider-verified generation source. */
export function AidtPrototypeTextBinding(props: Props) {
  const session = useOptionalSession()?.session;
  const scope = JSON.stringify([props.projectId, props.designId, session?.currentOrgId, session?.userId, session?.sessionToken]);
  return <TextBinding key={scope} {...props} scope={scope} userId={session?.userId} sessionToken={session?.sessionToken} />;
}
function TextBinding({ projectId, designId, draft, matchesServer, readOnly, onBind, scope, userId, sessionToken }: Props & { scope: string; userId?: string; sessionToken?: string }) {
  const reference = readAidtPrototypeReference(draft);
  const confirmation = readAidtPrototypeTextConfirmation(draft);
  const bindings = readAidtPrototypeTextOutputBindings(draft);
  const [preview, setPreview] = React.useState<{ versionId: string; snapshot: Snapshot }>();
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const operation = React.useRef<AbortController | null>(null);
  const identity = JSON.stringify([scope, reference?.versionId, draft.fields.prototypeTextConfirmation, readOnly, matchesServer]);
  const current = React.useRef(identity); current.current = identity;
  React.useEffect(() => {
    current.current = identity;
    operation.current?.abort(); operation.current = null; setBusy(false); setPreview(undefined);
    return () => { operation.current?.abort(); current.current = "unmounted"; };
  }, [identity]);
  async function showVersion(versionId: string) {
    if (!userId || !sessionToken || busy) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setNotice("");
    try {
      const binding = bindings.find(value => value.versionId === versionId && value.designId === designId);
      if (binding) await loadAidtBoundPrototypeTextSources({ projectId, designId, sessionToken, signal: controller.signal }, binding);
      else await loadAidtConfirmedPrototypeText({ projectId, designId, sessionToken, signal: controller.signal });
      const snapshot = await loadAidtPrototypeSnapshot({ projectId, userId, sessionToken, signal: controller.signal }, designId, versionId, "linked-reader");
      if (!controller.signal.aborted) setPreview({ versionId, snapshot });
    } catch { if (!controller.signal.aborted) setNotice("无法读取此确切原型版本；未替换成最新版本。"); }
    finally { if (!controller.signal.aborted) { operation.current = null; setBusy(false); } }
  }
  async function bind() {
    if (readOnly || busy || !matchesServer || !reference || preview?.versionId !== reference.versionId || !isAidtPrototypeTextConfirmed(draft)
      || !confirmation || !userId || !sessionToken) return;
    const identityAtStart = current.current, expected = JSON.stringify(confirmation);
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setNotice("");
    try {
      const allowed = await loadAidtConfirmedPrototypeText({ projectId, designId, sessionToken, signal: controller.signal });
      if (expected !== JSON.stringify(allowed.confirmation)) throw new Error("AIDT_CONTEXT_CHANGED");
      await loadAidtPrototypeSnapshot({ projectId, userId, sessionToken, signal: controller.signal }, designId, reference.versionId, "linked-reader");
      if (controller.signal.aborted || current.current !== identityAtStart) return;
      const metadata = { ...allowed.hashes, kind: "native" as const, bindingMethod: "student-selected-native-version" as const,
        boundBy: userId, boundAt: new Date().toISOString() };
      const next = bindAidtPrototypeTextOutput(draft, projectId, designId, reference.versionId, confirmation, metadata);
      if (next === draft) { setNotice("此版本已有不同的文字依据，或关联记录已满。原关系不改写；请选新输出或核对保存历史。"); return; }
      onBind(old => readAidtPrototypeReference(old)?.versionId === reference.versionId
        ? bindAidtPrototypeTextOutput(old, projectId, designId, reference.versionId, confirmation, metadata) : old);
      setNotice("已请求保存学生绑定关系；以小组保存回执为准。这不表示供应商独立核验了制作来源。");
    } catch { if (!controller.signal.aborted) setNotice("文字版本、来源授权或原型读取发生变化；未保存新绑定。"); }
    finally { if (!controller.signal.aborted) { operation.current = null; setBusy(false); } }
  }
  async function printPreview() {
    if (!preview || !userId || !sessionToken || busy) return;
    const identityAtStart = current.current, versionId = preview.versionId;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setNotice("");
    try {
      const binding = bindings.find(value => value.versionId === versionId && value.designId === designId);
      if (binding) await loadAidtBoundPrototypeTextSources({ projectId, designId, sessionToken, signal: controller.signal }, binding);
      else await loadAidtConfirmedPrototypeText({ projectId, designId, sessionToken, signal: controller.signal });
      const snapshot = await loadAidtPrototypeSnapshot({ projectId, userId, sessionToken, signal: controller.signal }, designId, versionId, "linked-reader");
      if (controller.signal.aborted || current.current !== identityAtStart) return;
      const result = await previewAidtPrototype(snapshot, `原型 ${designId} · 版本 ${versionId}`, {
        isCurrent: () => !controller.signal.aborted && current.current === identityAtStart,
      });
      if (result === "print-requested" && current.current === identityAtStart) setNotice("已请求系统打印／另存为 PDF；是否保存成功请以系统回执为准。");
    } catch { if (!controller.signal.aborted) setNotice("无法预览此确切原型版本，请重新核对访问权限和来源。"); }
    finally { if (!controller.signal.aborted) { operation.current = null; setBusy(false); } }
  }
  return <section aria-label="原型与文字设计的关系" className="space-y-2 text-12" data-testid="aidt-prototype-text-binding">
    {reference && <>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void showVersion(reference.versionId)}>查看所选原型的确切版本</Button>
      {!readOnly && <Button size="sm" variant="outline" disabled={busy || !matchesServer || !isAidtPrototypeTextConfirmed(draft) || preview?.versionId !== reference.versionId}
        onClick={() => void bind()}>将此原型用于该确认设计稿</Button>}
    </>}
    {preview && <><p>正在查看原型版本 {preview.versionId}；绑定是学生对制作依据的明确记录。</p><AidtTestPrototypePreview snapshot={preview.snapshot} />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void printPreview()}>预览／打印此原型的全部实际页</Button></>}
    {bindings.length > 0 && <details><summary className="cursor-pointer">{matchesServer ? "已保存的制作依据关联" : "本页待保存的制作依据关联"}</summary>{bindings.map(value => <section key={value.versionId} className="mt-2 space-y-1">
      <p>原型 {value.versionId} → <Link className="text-primary underline" href={`/aidt/${encodeURIComponent(projectId)}?${new URLSearchParams({ step: "5", entity: designId, textRevision: String(value.textStageRevision) })}`}>文字设计 · 第 5 步 V{value.textStageRevision}</Link></p>
      <p>{value.bindingMethod === "application-image-save" ? "应用保存图片时记录依据" : "学生明确选择该原型作为此稿方案"}；操作者 {value.boundBy}；{value.boundAt}</p>
      <p className="break-all">文字 SHA256：{value.textSha256}</p><p>供应商独立来源核验：未提供；本关系不授予任何资料权限。</p>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void showVersion(value.versionId)}>查看此历史原型版本</Button>
    </section>)}</details>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
