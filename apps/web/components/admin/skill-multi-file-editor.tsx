"use client";
import { useEffect, useRef, useState } from "react";
import { SkillPackagePath } from "@repo/contracts/standard-capabilities";
import { getAssetDirectory } from "@/lib/asset-directory";
import { getSkillFileSnapshot, saveSkillFiles, type SkillSnapshot, type SkillFileEdits } from "@/lib/live-skill-files";
import { runSkillTrialRun, pollSkillTrialRun } from "@/lib/skill-trial-run";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type File = Omit<SkillSnapshot["files"][number], "digest">;
function encode(text: string) { return btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join("")); }
function decode(file: File): string | null {
  try { const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(file.contentBase64), char => char.charCodeAt(0))); return text.includes("\0") ? null : text; } catch { return null; }
}
function changes(before: File[], after: File[]): SkillFileEdits {
  const result: SkillFileEdits = [];
  for (const file of before) if (!after.some(next => next.path === file.path)) result.push({ kind: "delete", path: file.path });
  for (const file of after) {
    const old = before.find(value => value.path === file.path);
    if (!old || old.contentBase64 !== file.contentBase64 || old.mediaType !== file.mediaType) result.push({ kind: "put", path: file.path, contentBase64: file.contentBase64, mediaType: file.mediaType });
  }
  return result;
}
const describe = (error: unknown) => error instanceof ApiError && error.status === 409 ? "版本冲突：其他人已保存新版本。你的修改仍保留；请先复制需要保留的内容，再明确放弃修改并读取最新版本。" : error instanceof Error ? error.message : "请求失败，请重试。";
export function SkillMultiFileEditor({ skillId }: { skillId: string }) {
  const [snapshot, setSnapshot] = useState<SkillSnapshot | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [selected, setSelected] = useState("SKILL.md");
  const [newPath, setNewPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [trialInput, setTrialInput] = useState("");
  const [trialResult, setTrialResult] = useState("");
  const [loadKey, setLoadKey] = useState(0);
  const pending = useRef(false);
  const epoch = useRef(0);
  const trialAbort = useRef<AbortController | null>(null);
  const mutations = snapshot ? changes(snapshot.files, files) : [];
  const dirty = mutations.length > 0;
  const current = files.find(file => file.path === selected);
  const content = current ? decode(current) : null;
  useEffect(() => {
    let active = true; const effectEpoch = ++epoch.current; pending.current = false; setConfirmSave(false); setConfirmDiscard(false); setConfirmDelete(false); setNewPath(""); setNotice(""); setTrialInput(""); setBusy(true); setError(""); setSnapshot(null); setFiles([]); setTrialResult("");
    getAssetDirectory("skill", skillId).then(directory => {
      if (!directory.currentVersionId) throw new Error("这个 Skill 尚无可编辑的发布版本。");
      return getSkillFileSnapshot(skillId, directory.currentVersionId);
    }).then(value => { if (active) { setSnapshot(value); setFiles(value.files); setSelected("SKILL.md"); } }).catch(reason => { if (active) setError(describe(reason)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; epoch.current = effectEpoch + 1; trialAbort.current?.abort(); };
  }, [skillId, loadKey]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || event.defaultPrevented || link.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm("还有未保存的文件修改。确认丢弃修改并离开？")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  const edited = () => { setConfirmSave(false); setConfirmDiscard(false); setConfirmDelete(false); setTrialResult(""); setNotice(""); };
  const save = async () => {
    if (!snapshot || !dirty || !confirmSave || snapshot.readOnly || pending.current) return;
    const requestEpoch = epoch.current;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await saveSkillFiles(skillId, snapshot.versionId, mutations);
      if (requestEpoch !== epoch.current) return;
      setSnapshot(result); setFiles(result.files); setSelected(result.files.some(file => file.path === selected) ? selected : "SKILL.md");
      setConfirmSave(false); setConfirmDiscard(false); setTrialResult(""); setNotice(`已保存并发布 ${result.semanticLabel}，全部文件属于版本 ${result.versionId}。已有 Agent 固定版本保持原样。`);
    } catch (reason) { if (requestEpoch === epoch.current) setError(describe(reason)); } finally { if (requestEpoch === epoch.current) { pending.current = false; setBusy(false); } }
  };
  const trial = async () => {
    if (!snapshot || dirty || pending.current || !trialInput.trim()) return;
    pending.current = true; setBusy(true); setError(""); setTrialResult("");
    const abort = new AbortController(); trialAbort.current = abort;
    const versionId = snapshot.versionId; const requestEpoch = epoch.current;
    try {
      const submitted = await runSkillTrialRun(versionId, trialInput);
      if (requestEpoch !== epoch.current || abort.signal.aborted) return;
      const result = submitted.trialRun ? { trialRun: submitted.trialRun, failure: null } : submitted.asyncTaskId ? await pollSkillTrialRun(submitted.asyncTaskId, { signal: abort.signal }) : null;
      if (abort.signal.aborted || requestEpoch !== epoch.current) return;
      if (!result?.trialRun) throw new Error(result?.failure ? `${result.failure.code}: ${result.failure.stderr}` : "试跑没有返回结果，请稍后重试。");
      if (result.trialRun.versionId !== versionId) throw new Error("试跑结果与请求版本不匹配，未展示结果。");
      setTrialResult(`版本 ${versionId}\n${result.trialRun.output}`);
    } catch (reason) { if (!abort.signal.aborted && requestEpoch === epoch.current) setError(describe(reason)); } finally { if (requestEpoch === epoch.current) { pending.current = false; if (!abort.signal.aborted) setBusy(false); } }
  };
  return <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Skill 多文件编辑器" data-testid="skill-multi-file-editor">
    <div className="flex flex-wrap items-center gap-3 text-12"><span data-testid="skill-file-version">{snapshot ? `${snapshot.semanticLabel} · ${snapshot.versionId}` : busy ? "正在读取真实文件快照" : "尚未加载文件快照"}</span>{dirty && <span className="text-warning">{mutations.length} 个路径待保存</span>}{snapshot?.readOnly && <span>平台来源只读</span>}</div>
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-13 text-destructive">{error}</p>}{notice && <p role="status" className="text-13">{notice}</p>}
    {!snapshot && !busy && <Button variant="outline" onClick={() => setLoadKey(key => key + 1)}>重新读取</Button>}
    {snapshot && <>
      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-3 rounded-control border border-border p-3"><h3 className="text-13 font-medium">文件</h3><div className="flex flex-col gap-1">{files.map(file => <Button key={file.path} variant={selected === file.path ? "secondary" : "ghost"} className="justify-start overflow-hidden" disabled={busy} onClick={() => { setSelected(file.path); setConfirmDelete(false); }} title={file.path}>{file.path}</Button>)}</div>
          <label className="block text-12" htmlFor="skill-new-file">新文件路径<Input id="skill-new-file" placeholder="scripts/analyze.py" value={newPath} disabled={busy || snapshot.readOnly} onChange={event => setNewPath(event.target.value)} /></label>
          <Button variant="outline" disabled={busy || snapshot.readOnly || !newPath} onClick={() => {
            const parsed = SkillPackagePath.safeParse(newPath);
            if (!parsed.success || files.some(file => file.path === newPath)) { setError("路径无效或已存在，请使用不含 .. 的唯一相对文件路径。"); return; }
            setFiles(value => [...value, { path: newPath, contentBase64: "", mediaType: newPath.endsWith(".md") ? "text/markdown" : "text/plain", sizeBytes: 0 }]); setSelected(newPath); setNewPath(""); setError(""); edited();
          }}>新建文件</Button>
        </aside>
        <div className="flex min-h-0 flex-col gap-2"><h3 className="break-all text-13 font-medium">{selected}</h3>{current && content !== null ? <Textarea aria-label="文件内容" className="min-h-72 flex-1 font-mono text-13" value={content} disabled={busy || snapshot.readOnly} spellCheck={false} onChange={event => { const text = event.target.value; setFiles(value => value.map(file => file.path === selected ? { ...file, contentBase64: encode(text), sizeBytes: new TextEncoder().encode(text).length } : file)); edited(); }} /> : <p className="text-13">此文件不是可编辑的 UTF-8 文本。保存其他文件时将原样保留。</p>}
          {selected !== "SKILL.md" && current && !snapshot.readOnly && <div className="flex flex-wrap items-center gap-3"><label className="flex gap-2 text-12"><input type="checkbox" checked={confirmDelete} disabled={busy} onChange={event => setConfirmDelete(event.target.checked)} />确认从下一版本删除 {selected}</label><Button variant="destructive" disabled={busy || !confirmDelete} onClick={() => { setFiles(value => value.filter(file => file.path !== selected)); setSelected("SKILL.md"); edited(); }}>删除所选文件</Button></div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3"><label className="flex gap-2 text-12"><input type="checkbox" checked={confirmSave} disabled={busy || !dirty || snapshot.readOnly} onChange={event => setConfirmSave(event.target.checked)} />确认统一保存全部修改并发布新版本</label><Button variant="primary" disabled={busy || !dirty || !confirmSave || snapshot.readOnly} onClick={save}>保存全部文件并发布</Button><label className="flex gap-2 text-12"><input type="checkbox" checked={confirmDiscard} disabled={busy || !dirty} onChange={event => setConfirmDiscard(event.target.checked)} />放弃本页未保存修改</label><Button variant="outline" disabled={busy || dirty && !confirmDiscard} onClick={() => { setConfirmDiscard(false); setConfirmSave(false); setLoadKey(key => key + 1); }}>读取最新版本</Button></div>
      <details className="border-t border-border pt-3"><summary className="cursor-pointer text-13">试跑当前已保存版本</summary><div className="mt-3 space-y-2"><p className="text-12">试跑版本：{snapshot.versionId}。{dirty ? "请先保存全部文件，避免试跑旧内容。" : "试跑调用真实服务，不会修改已有 Agent 固定版本。"}</p><Textarea aria-label="试跑输入" value={trialInput} disabled={busy} onChange={event => setTrialInput(event.target.value)} /><Button variant="outline" disabled={busy || dirty || !trialInput.trim()} onClick={trial}>试跑已保存版本</Button>{trialResult && <pre className="whitespace-pre-wrap break-words text-12" data-testid="skill-file-trial-result">{trialResult}</pre>}</div></details>
    </>}
  </section>;
}
