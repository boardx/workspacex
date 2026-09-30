"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { research as C } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { researchPlanTitle } from "@/lib/guided-research-markdown";
import type { GuidedResearchRuntime } from "@/lib/guided-research-api";

type Outline = GuidedResearchRuntime["outline"];
export function GuidedResearchPlanEditor({ value, disabled, onSave, onDirtyChange }: {
  value: Outline; disabled: boolean; onSave: (value: Outline) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [items, setItems] = React.useState(value);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const server = React.useRef(value);
  React.useEffect(() => {
    if (JSON.stringify(server.current) !== JSON.stringify(value)) {
      server.current = value; setItems(value); setEditing(null);
    }
  }, [value]);
  const dirty = JSON.stringify(items) !== JSON.stringify(value);
  React.useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const visible = items.filter((item) => item.enabled).sort((a, b) => a.order - b.order);
  const valid = C.GuidedResearchRuntimeDraft.safeParse({ node: "outline", value: items }).success;
  const locked = disabled || saving;
  async function save() {
    setConfirm(false); setSaving(true); setError(null);
    try {
      if (await onSave(items)) setEditing(null);
      else setError("计划未保存，请重试。");
    } catch { setError("计划未保存，请重试。"); }
    finally { setSaving(false); }
  }
  return <section className="space-y-4">
    <ol aria-label="研究计划" className="list-none space-y-3">
      {visible.map((item, index) => <li key={item.id} className="flex items-center gap-3">
        <span className="w-6 shrink-0 text-sm text-muted-foreground">{index + 1}.</span>
        {editing === item.id ? <Input autoFocus aria-label={`计划 ${index + 1}`} value={researchPlanTitle(item.title)} maxLength={200} disabled={locked}
          onChange={(event) => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, title: event.target.value } : entry))}
          onKeyDown={(event) => { if (event.key === "Enter") setEditing(null); }} />
          : <button type="button" aria-label={`编辑计划 ${index + 1}：${researchPlanTitle(item.title)}`} disabled={locked}
            onClick={() => setEditing(item.id)} className="min-h-11 min-w-0 flex-1 rounded-lg border bg-card px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {researchPlanTitle(item.title)}
          </button>}
        <Button variant="ghost" size="icon" aria-label={`删除计划 ${index + 1}`} disabled={locked || visible.length <= 1}
          onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id).map((entry, order) => ({ ...entry, order })))}><Trash2 className="size-4" /></Button>
      </li>)}
    </ol>
    <div className="flex flex-wrap justify-between gap-3">
      <Button variant="outline" disabled={locked || items.length >= 30} onClick={() => {
        const id = crypto.randomUUID();
        setItems((current) => [...current, { id, title: "新计划", enabled: true, order: current.length, questions: ["需要回答什么问题？"] }]); setEditing(id);
      }}><Plus className="mr-2 size-4" />新增计划</Button>
      {dirty && <div className="flex gap-2"><Button variant="outline" disabled={locked} onClick={() => { setItems(value); setEditing(null); setError(null); }}>取消</Button><Button variant="primary" disabled={locked || !valid} onClick={() => setConfirm(true)}>保存计划</Button></div>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogTitle>确认修改研究计划</DialogTitle><DialogDescription>保存后需要重新确认计划并更新相关研究资料，已有历史报告会保留。</DialogDescription><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirm(false)}>继续编辑</Button><Button variant="primary" onClick={() => void save()}>确认保存</Button></div></DialogContent></Dialog>
  </section>;
}
