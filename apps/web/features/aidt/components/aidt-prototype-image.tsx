"use client";

import * as React from "react";
import { parseVfsUriString } from "@repo/contracts/agui-state-events";
import { ProducedFilesCtx } from "@/components/chat/copilotkit-v2-assistant-message";
import { useOptionalSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-client";
import { fileToImageSrc } from "@/lib/prototype-image-upload";
import { isAidtImagePrototypeVersion, loadAidtPrototypeImagePreview, saveAidtPrototypeImage, type AidtPrototypeVersionReference } from "../lib/aidt-prototype-versions";
import { loadAidtConfirmedPrototypeText, loadAidtBoundPrototypeTextSources } from "../lib/aidt-prototype-confirmed-text";
import type { AidtPrototypeTextConfirmation, AidtPrototypeTextOutputBinding } from "../lib/aidt-prototype-text-state";

const raster = /^image\/(?:png|jpeg|webp|gif)$/;

export function AidtPrototypeImage({ projectId, designId, textConfirmation, onSaved }: {
  projectId: string; designId: string; textConfirmation: AidtPrototypeTextConfirmation;
  onSaved: (value: AidtPrototypeVersionReference, basis: AidtPrototypeTextConfirmation,
    metadata: Pick<AidtPrototypeTextOutputBinding, "kind" | "bindingMethod" | "boundBy" | "boundAt" | "textSha256" | "lineageSha256">) => void;
}) {
  const session = useOptionalSession()?.session;
  const { files, threadId } = React.useContext(ProducedFilesCtx);
  const [file, setFile] = React.useState<File>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const operation = React.useRef<AbortController | null>(null);
  const textBasisKey = JSON.stringify(textConfirmation);
  React.useEffect(() => {
    setBusy(false);
    return () => operation.current?.abort();
  }, [projectId, designId, session?.sessionToken, session?.userId, threadId, textBasisKey]);

  const generated = files.flatMap(item => {
    const uri = parseVfsUriString(item.uri);
    return item.source === "agent_run_output" && raster.test(item.mime ?? "") && uri?.domain === "attachment"
      ? [{ name: item.name, id: uri.id }] : [];
  });

  async function create(name: string, load: (signal: AbortSignal) => Promise<Blob>) {
    if (operation.current && !operation.current.signal.aborted) return;
    if (!session?.userId || !session.sessionToken) return;
    const controller = new AbortController();
    const { signal } = controller;
    operation.current = controller;
    setBusy(true); setError(false); setSaved(false);
    try {
      const allowed = await loadAidtConfirmedPrototypeText({ projectId, designId, sessionToken: session.sessionToken, signal });
      if (JSON.stringify(allowed.confirmation) !== JSON.stringify(textConfirmation)) throw new Error("AIDT_PROTOTYPE_TEXT_VERSION_MISMATCH");
      const image = await fileToImageSrc(await load(signal), true);
      if (signal.aborted) return;
      // Recheck consent and the confirmed revision after reading the image, before writing output.
      const current = await loadAidtConfirmedPrototypeText({ projectId, designId, sessionToken: session.sessionToken, signal });
      if (JSON.stringify(current.confirmation) !== JSON.stringify(textConfirmation)) throw new Error("AIDT_PROTOTYPE_TEXT_VERSION_MISMATCH");
      const version = await saveAidtPrototypeImage({
        projectId, sessionToken: session.sessionToken, userId: session.userId, signal,
      }, designId, image, name, { stageRevision: textConfirmation.stageRevision, textVersion: textConfirmation.textVersion });
      if (!signal.aborted) {
        onSaved(version, textConfirmation, { ...current.hashes, kind: "image", bindingMethod: "application-image-save", boundBy: session.userId, boundAt: new Date().toISOString() });
        setSaved(true);
      }
    } catch {
      if (!signal.aborted) setError(true);
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (!signal.aborted) setBusy(false);
      }
    }
  }

  async function readGenerated(id: string, signal: AbortSignal) {
    if (!threadId || !session?.sessionToken) throw new Error("AIDT_PROTOTYPE_IMAGE_UNAVAILABLE");
    const response = await fetch(apiUrl(`/chat/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(id)}/content`), {
      headers: { Authorization: `Bearer ${session.sessionToken}` }, signal,
    });
    if (!response.ok) throw new Error("AIDT_PROTOTYPE_IMAGE_UNAVAILABLE");
    return response.blob();
  }

  if (!session?.sessionToken) return null;
  return <details className="space-y-2">
    <summary className="cursor-pointer font-medium">用图片制作静态原型</summary>
    <p className="text-12">制作依据：已确认文字设计 · 第 5 步 V{textConfirmation.stageRevision}。</p>
    <p className="text-12 text-muted-foreground">上传小组作品，或在本对话生成图片后选择。静态图可验证理解或意向，购买、付费和实际耗时需要另行观察。</p>
    <label className="block text-12">上传图片
      <input aria-label="上传原型图片" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} className="mt-1 block w-full" onChange={event => setFile(event.currentTarget.files?.[0])} />
    </label>
    <Button type="button" size="sm" variant="outline" disabled={busy || !file || !raster.test(file.type)} onClick={() => {
      if (file) void create(file.name, async () => file);
    }}>保存上传图片方案</Button>
    {threadId && generated.length > 0 && <ul className="space-y-1">{generated.map(image =>
      <li key={image.id}><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void create(image.name, signal => readGenerated(image.id, signal))}>
        使用生成图片：{image.name}
      </Button></li>)}</ul>}
    {busy && <p role="status">正在保存并核对版本…</p>}
    {saved && <p role="status">图片方案已保存，请确认要带入测试的版本。</p>}
    {error && <p role="alert">图片版本未能核对。原有方案仍可使用，请重试。</p>}
  </details>;
}

export function AidtPrototypeImagePreview({ projectId, reference, binding }: { projectId: string; reference: AidtPrototypeVersionReference; binding?: AidtPrototypeTextOutputBinding | null }) {
  const session = useOptionalSession()?.session;
  const [state, setState] = React.useState<{ key: string; image: { src: string; alt: string } | null }>();
  const key = JSON.stringify([projectId, session?.userId, session?.sessionToken, reference.designId, reference.versionId, reference.summary, binding]);
  const current = React.useRef(reference);
  current.current = reference;
  React.useEffect(() => {
    if (!session?.userId || !session.sessionToken || !isAidtImagePrototypeVersion(current.current)) return;
    const userId = session.userId, sessionToken = session.sessionToken;
    const controller = new AbortController();
    const access = binding ? loadAidtBoundPrototypeTextSources({ projectId, designId: reference.designId, sessionToken, signal: controller.signal }, binding) : Promise.resolve();
    void access.then(() => loadAidtPrototypeImagePreview({ projectId, userId, sessionToken, signal: controller.signal }, current.current))
      .then(image => { if (!controller.signal.aborted) setState({ key, image }); })
      .catch(() => { if (!controller.signal.aborted) setState({ key, image: null }); });
    return () => controller.abort();
  // key contains the complete immutable reference and optional text binding.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, projectId, session?.userId, session?.sessionToken]);
  if (!isAidtImagePrototypeVersion(reference) || !session?.userId || !session.sessionToken) return null;
  if (state?.key !== key) return <p role="status" className="text-12">正在核对图片版本…</p>;
  if (!state.image) return <p role="alert" className="text-12">当前无法读取这个图片版本。</p>;
  // eslint-disable-next-line @next/next/no-img-element -- validated native Design raster data URL
  return <img src={state.image.src} alt={state.image.alt} className="max-h-64 w-full rounded-md object-contain" />;
}
