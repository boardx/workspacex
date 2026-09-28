"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { Plus, Search, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type { DigitalExpertCatalogRow } from "@/lib/interview-api";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ExpertAvatarEditor } from "./expert-avatar";
import { InterviewReportMarkdown } from "./interview-report-markdown";

function text(value: string) { return value.replace(/[\\[\]()*_`#<>]/gu, "\\$&").replace(/[\r\n]+/gu, " "); }
function SelectedAvatar({ id, name, directory, context, savedIds }: { id: string; name: string; directory: readonly DigitalExpertCatalogRow[]; context?: { interviewId: string; revisionId: string }; savedIds: readonly string[] }) {
  const virtual = !directory.some((expert) => expert.expertId === id);
  return <ExpertAvatarEditor expertId={id} displayName={name} compact context={virtual ? context : undefined} disabled={virtual && (!context || !savedIds.includes(id))} disabledReason="请先保存专家草稿，再修改虚拟专家头像。" />;
}
export function InterviewExpertsStep({ document, directory, pending, onChange, onSave, onConfirm, onGenerate, avatarContext, savedExpertIds = [] }: {
  document: InterviewMarkdownDocument; directory: readonly DigitalExpertCatalogRow[]; pending: boolean;
  onChange: (markdown: string) => void; onSave: () => void; onConfirm: () => void; onGenerate: () => void;
  avatarContext?: { interviewId: string; revisionId: string };
  savedExpertIds?: readonly string[];
}) {
  const [query, setQuery] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [profile, setProfile] = React.useState("");
  const [reviewed, setReviewed] = React.useState(false);
  const projection = interviewMarkdown.parseInterviewMarkdown(document);
  const selected = projection.blocks.flatMap((block) => {
    const link = block.links.find((item) => /^#expert-[a-zA-Z0-9_-]+$/u.test(item.url));
    return link ? [{ block, id: link.url.slice(8), name: link.text }] : [];
  });
  const visible = directory.filter((expert) => (!domain || expert.domains.includes(domain)) && `${expert.displayName} ${expert.role} ${expert.domains.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function append(id: string, title: string, markdown: string) {
    onChange(`${document.markdown}\n\n## [${text(title)}](#expert-${id})\n\n${markdown}\n`);
  }
  function move(index: number, delta: number) {
    const first = selected[Math.min(index, index + delta)]?.block;
    const second = selected[Math.max(index, index + delta)]?.block;
    if (!first || !second) return;
    const raw = document.markdown;
    onChange(raw.slice(0, first.start) + raw.slice(second.start, second.end) + raw.slice(first.end, second.start) + raw.slice(first.start, first.end) + raw.slice(second.end));
  }
  return <div data-testid="itv-markdown-experts">
    <h2 className="text-2xl font-semibold">选择专家</h2><p className="mt-2 text-sm text-muted-foreground">选择互补专业角色。虚拟画像仅用于模拟研究，不等同真人访谈。</p>
    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <section className="rounded-xl border border-border p-5"><h3 className="text-xl font-semibold">专家库</h3>
        <div className="mt-4 flex flex-wrap gap-3"><label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-input px-3"><Search className="size-4" aria-hidden /><input aria-label="搜索专家" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="姓名、角色或专业领域" className="w-full bg-transparent py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label><select aria-label="专家领域" value={domain} onChange={(event) => setDomain(event.target.value)} className="rounded-lg border border-input bg-background px-3 text-sm"><option value="">全部领域</option>{Array.from(new Set(directory.flatMap((expert) => expert.domains))).map((value) => <option key={value}>{value}</option>)}</select><Button variant="outline" disabled={pending} onClick={() => { setName(""); setProfile(""); setReviewed(false); setOpen(true); }}>添加虚拟专家</Button></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((expert) => <article key={expert.expertId} className="rounded-xl border border-border p-4"><ExpertAvatarEditor expertId={expert.expertId} displayName={expert.displayName} compact /><h4 className="mt-3 font-semibold">{expert.displayName}</h4><p className="mt-1 text-xs text-muted-foreground">{expert.role}</p><p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{expert.bio}</p><Button className="mt-4" variant="outline" disabled={pending || selected.some((entry) => entry.id === expert.expertId)} aria-label={`添加专家 ${expert.displayName}`} onClick={() => append(expert.expertId, expert.displayName, `专业角色：${text(expert.role)}\n\n领域：${expert.domains.map(text).join("、")}\n\n${text(expert.bio)}\n\n材料边界：${text(expert.materialBoundary)}`)}><Plus className="size-4" aria-hidden />添加</Button></article>)}</div>
        {!visible.length && <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的专家</p>}
      </section>
      <aside className="rounded-xl border border-border p-5"><h3 className="text-xl font-semibold">已选择专家 {selected.length}</h3><div className="mt-4 space-y-3">{selected.map((entry, index) => <article key={entry.id} className="rounded-lg border border-border p-3"><div className="flex items-center gap-2"><SelectedAvatar id={entry.id} name={entry.name} directory={directory} context={avatarContext} savedIds={savedExpertIds} /><strong className="min-w-0 flex-1 text-sm">{entry.name}</strong><Button variant="ghost" size="icon" disabled={pending} aria-label={`移除专家 ${entry.name}`} onClick={() => onChange(document.markdown.slice(0, entry.block.start) + document.markdown.slice(entry.block.end))}><Trash2 className="size-4" aria-hidden /></Button></div><div className="mt-2 flex gap-2"><Button variant="ghost" size="sm" disabled={pending || index === 0} aria-label={`上移专家 ${entry.name}`} onClick={() => move(index, -1)}><ArrowUp className="size-4" aria-hidden /></Button><Button variant="ghost" size="sm" disabled={pending || index === selected.length - 1} aria-label={`下移专家 ${entry.name}`} onClick={() => move(index, 1)}><ArrowDown className="size-4" aria-hidden /></Button></div></article>)}</div><p className="mt-4 text-xs leading-6 text-muted-foreground">专家绑定稳定 ID；专家库头像在登录后保存到当前账号，跨会话同步。</p></aside>
    </div>
    <details className="mt-5 rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">审阅与编辑专家画像 Markdown</summary><textarea aria-label="专家文档 Markdown" value={document.markdown} disabled={pending} onChange={(event) => onChange(event.target.value)} className="mt-4 min-h-64 w-full rounded-lg border border-input bg-background p-3 text-sm leading-7" /><InterviewReportMarkdown markdown={document.markdown} testId="itv-expert-document-preview" /></details>
    <footer className="mt-6 flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={pending} onClick={onGenerate}>生成专家建议</Button><Button variant="outline" disabled={pending || !document.markdown.trim()} onClick={onSave}>保存专家草稿</Button><Button variant="primary" disabled={pending || !selected.length} onClick={onConfirm}>确认专家并生成问题</Button></footer>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogTitle>添加虚拟专家</DialogTitle><DialogDescription>填写并审阅虚拟专业角色，不编造真人任职或研究经历。</DialogDescription><label className="text-sm">专家名称<input aria-label="专家名称" value={name} onChange={(event) => { setName(event.target.value); setReviewed(false); }} className="mt-2 w-full rounded-lg border border-input bg-background p-3" /></label><label className="text-sm">专家画像 Markdown<textarea aria-label="专家画像 Markdown" value={profile} onChange={(event) => { setProfile(event.target.value); setReviewed(false); }} className="mt-2 min-h-40 w-full rounded-lg border border-input bg-background p-3" /></label><InterviewReportMarkdown markdown={profile} testId="itv-virtual-expert-preview" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />已审阅画像及模拟边界</label><Button variant="primary" disabled={pending || !reviewed || !name.trim() || !profile.trim()} onClick={() => { append(`virtual-${crypto.randomUUID()}`, name, profile); setOpen(false); }}>保存并添加专家</Button></DialogContent></Dialog>
  </div>;
}
