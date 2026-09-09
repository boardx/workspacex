"use client";
import { useEffect, useState } from "react";
import { operations } from "@repo/contracts/capability-admin-deltas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

const initialConfig = { providerKey: "demo", upstreamModelId: "research-upstream", endpoint: "https://example.test/models" };

/** Design-only revision conflict flow. Credentials are never persisted or sent anywhere. */
export function ModelConfigurationPreview({ revision, onSaved, onConflictChange }: {
  revision: number; onSaved: (expectedRevision: number) => void; onConflictChange: (conflict: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loadedRevision, setLoadedRevision] = useState(revision);
  const [savedConfig, setSavedConfig] = useState(initialConfig);
  const [draft, setDraft] = useState(initialConfig);
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (open && revision !== loadedRevision) {
      setCredential(""); setConflict(true); onConflictChange(true);
      setError("配置已由其他操作修改。保留了你的非敏感输入，凭据输入已清空；请加载最新配置或重新审阅修改。");
    }
  }, [open, revision, loadedRevision, onConflictChange]);
  const resolve = (keepDraft: boolean) => {
    if (!keepDraft) setDraft(savedConfig);
    setLoadedRevision(revision); setCredential(""); setConflict(false); onConflictChange(false); setError("");
  };
  const save = () => {
    if (revision !== loadedRevision || conflict) return;
    const parsed = operations.configureModel.in.safeParse({ modelId: "research-model", expectedVersion: String(loadedRevision),
      patch: { ...draft, ...(credential ? { credential } : {}) } });
    setCredential("");
    if (!parsed.success) { setError("检查 provider 与模型标识。provider仅允许小写字母、数字、点、横线和下划线。"); return; }
    setSavedConfig(draft); onSaved(loadedRevision); setOpen(false); setError("");
  };
  return <>
    <p className="text-12 text-muted-foreground" data-testid="model-current-mapping">research-model → {savedConfig.providerKey} / {savedConfig.upstreamModelId}</p>
    <Button data-testid="model-configure" variant="outline" onClick={() => { if (!conflict) { setLoadedRevision(revision); setDraft(savedConfig); setError(""); } setOpen(true); }}>编辑模型运行配置</Button>
    <Dialog open={open} onOpenChange={value => { setCredential(""); setOpen(value); }}>
      <DialogContent className="max-w-xl" closeTestId="model-config-close">
        <DialogTitle>模型配置 · research-model</DialogTitle>
        <DialogDescription>单模型 · 当前 r{revision} / 载入 r{loadedRevision}。交互演示，不发送或保存真实凭据。</DialogDescription>
        <div className="space-y-4 overflow-y-auto">
          <label className="block text-12" htmlFor="model-provider">Provider 标识<Input id="model-provider" data-testid="model-provider" value={draft.providerKey} onChange={event => setDraft({ ...draft, providerKey: event.target.value })} /></label>
          <label className="block text-12" htmlFor="model-upstream">上游模型标识<Input id="model-upstream" data-testid="model-upstream" value={draft.upstreamModelId} onChange={event => setDraft({ ...draft, upstreamModelId: event.target.value })} /></label>
          <label className="block text-12" htmlFor="model-endpoint">连接端点<Input id="model-endpoint" value={draft.endpoint} onChange={event => setDraft({ ...draft, endpoint: event.target.value })} /></label>
          <label className="block text-12" htmlFor="model-credential">替换凭据（仅使用演示文本）<Input id="model-credential" data-testid="model-credential" type="password" autoComplete="off" value={credential} onChange={event => setCredential(event.target.value)} /></label>
          <p className="text-12 text-muted-foreground">留空保留原凭据。提交、冲突或关闭后清空输入；运行配置变化后重新完成准入测试。</p>
          {error && <p role="alert" data-testid="model-config-error" className="text-12 text-destructive">{error}</p>}
          {conflict && <div className="space-y-2 rounded-control border border-warning p-3"><p className="text-13">载入 r{loadedRevision}，当前 r{revision}</p><div className="flex flex-wrap gap-2"><Button variant="outline" data-testid="model-load-latest" onClick={() => resolve(false)}>加载最新配置</Button><Button variant="outline" data-testid="model-reapply" onClick={() => resolve(true)}>按最新版本重新审阅我的修改</Button></div></div>}
          <Button variant="ghost" data-testid="model-simulate-conflict" disabled={conflict} onClick={() => { setSavedConfig({ ...savedConfig, upstreamModelId: "research-upstream-updated" }); onSaved(revision); }}>模拟另一管理员保存</Button>
        </div>
        <DialogFooter><Button variant="primary" data-testid="model-config-save" disabled={conflict || revision !== loadedRevision} onClick={save}>保存演示配置并重测</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
