"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { Plus, Search, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type { DigitalExpertCatalogRow } from "@/lib/interview-api";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ExpertAvatar, ExpertAvatarEditor } from "./expert-avatar";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { ExpertSpecialtyIcon } from "./expert-specialty-icon";
import { INTERVIEW_PERSONAS, INTERVIEW_PERSONA_CATEGORIES, personaAnchorId } from "@/lib/interview-personas/persona-library";

const PAGE_SIZE = 9;

function text(value: string) { return value.replace(/[\\[\]()*_`#<>]/gu, "\\$&").replace(/[\r\n]+/gu, " "); }
function SelectedAvatar({ id, name, directory, context, savedIds }: { id: string; name: string; directory: readonly DigitalExpertCatalogRow[]; context?: { interviewId: string; revisionId: string }; savedIds: readonly string[] }) {
  const virtual = !directory.some((expert) => expert.expertId === id);
  return <ExpertAvatarEditor expertId={id} displayName={name} compact context={virtual ? context : undefined} disabled={virtual && (!context || !savedIds.includes(id))} disabledReason="请先保存专家草稿，再修改虚拟专家头像。" />;
}
export function InterviewExpertsStep({ document, directory, directoryStatus = "ready", onRetryDirectory, pending, onChange, onSave, onConfirm, onGenerate, avatarContext, savedExpertIds = [], showRecoveryContext = false }: {
  document: InterviewMarkdownDocument; directory: readonly DigitalExpertCatalogRow[]; pending: boolean;
  directoryStatus?: "loading" | "ready" | "error"; onRetryDirectory?: () => void;
  onChange: (markdown: string) => void; onSave: () => void; onConfirm: () => void; onGenerate: () => void;
  avatarContext?: { interviewId: string; revisionId: string };
  savedExpertIds?: readonly string[];
  showRecoveryContext?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [profile, setProfile] = React.useState("");
  const [reviewed, setReviewed] = React.useState(false);
  const projection = interviewMarkdown.parseInterviewMarkdown(document);
  const selected = projection.blocks.flatMap((block) => {
    const link = block.links.find((item) => /^#expert-[a-zA-Z0-9_-]+$/u.test(item.url));
    return link ? [{ block, id: link.url.slice(8), name: link.text }] : [];
  });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = directory.filter((expert) => (!domain || expert.domains.includes(domain)) && `${expert.displayName} ${expert.role} ${expert.domains.join(" ")}`.toLocaleLowerCase().includes(normalizedQuery));
  const personas = INTERVIEW_PERSONAS.filter((persona) => (!domain || persona.category === domain) && `${persona.name} ${persona.specialty} ${persona.category} ${persona.bio}`.toLocaleLowerCase().includes(normalizedQuery));
  const pageCount = Math.max(1, Math.ceil(personas.length / PAGE_SIZE));
  const visiblePersonas = personas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const domains = Array.from(new Set([...INTERVIEW_PERSONA_CATEGORIES, ...directory.flatMap((expert) => expert.domains)]));
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
    <h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">选择专家</h2><p className="mt-2 text-base leading-7 text-muted-foreground">选择互补专业角色。虚拟画像仅用于模拟研究，不等同真人访谈。</p>
    <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <section className="rounded-xl border border-border p-5"><h3 className="text-xl font-semibold">专家库</h3>
        <div className="mt-4 flex flex-wrap gap-3"><label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-input px-3"><Search className="size-4" aria-hidden /><input aria-label="搜索专家" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="姓名、角色或专业领域" className="w-full bg-transparent py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label><select aria-label="专家领域" value={domain} onChange={(event) => { setDomain(event.target.value); setPage(1); }} className="rounded-lg border border-input bg-background px-3 text-sm"><option value="">全部领域</option>{domains.map((value) => <option key={value}>{value}</option>)}</select><Button variant="outline" disabled={pending} onClick={() => { setName(""); setProfile(""); setReviewed(false); setOpen(true); }}>添加虚拟专家</Button></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((expert) => <article key={expert.expertId} className="rounded-xl border border-border p-4"><ExpertAvatarEditor expertId={expert.expertId} displayName={expert.displayName} compact /><h4 className="mt-3 font-semibold">{expert.displayName}</h4><p className="mt-1 text-xs text-muted-foreground">{expert.role}</p><p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{expert.bio}</p><Button className="mt-4" variant="outline" disabled={pending || selected.some((entry) => entry.id === expert.expertId)} aria-label={`添加专家 ${expert.displayName}`} onClick={() => append(expert.expertId, expert.displayName, `专业角色：${text(expert.role)}\n\n领域：${expert.domains.map(text).join("、")}\n\n${text(expert.bio)}\n\n材料边界：${text(expert.materialBoundary)}`)}><Plus className="size-4" aria-hidden />添加</Button></article>)}</div>
        {directoryStatus === "loading" ? <div data-testid="itv-expert-directory-loading" className="animate-pulse rounded-lg border border-border bg-muted/30 px-5 py-6 text-center text-sm text-muted-foreground">正在载入专家库…</div> : directoryStatus === "error" ? <div data-testid="itv-expert-directory-error" role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-6 text-center"><p className="text-sm text-destructive">专家库载入失败，维护的模拟画像仍可选择。</p><Button className="mt-4" variant="outline" onClick={onRetryDirectory}>重试载入专家库</Button></div> : !directory.length ? <div data-testid="itv-expert-directory-empty" className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">当前组织暂无可用的已发布专家；下方可选择维护的模拟画像，或手动添加虚拟专家。</div> : null}
        <div className="mt-5 border-t border-border pt-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-lg font-semibold">模拟专家画像</h4><span className="text-sm text-muted-foreground">{personas.length} 位模拟画像</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">来自维护的画像库；不是组织已发布专家，也不能作为真人访谈证据。</p></div>
        {personas.length ? <><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visiblePersonas.map((persona) => <article key={persona.id} data-testid={`itv-persona-card-${personaAnchorId(persona)}`} className="rounded-xl border border-border bg-card p-4"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ExpertSpecialtyIcon category={persona.category} /></span><div className="min-w-0"><h5 className="font-semibold">{persona.name}</h5><p className="text-xs text-muted-foreground">{persona.specialty}</p></div></div><p className="mt-2 text-xs text-muted-foreground">{persona.category} · 模拟画像</p><p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{persona.bio}</p><Button className="mt-3" variant="outline" disabled={pending || selected.some((entry) => entry.id === personaAnchorId(persona))} aria-label={`添加画像 ${persona.name}`} onClick={() => append(personaAnchorId(persona), persona.name, `画像类型：模拟画像；不是组织已发布专家或真人访谈证据。\n\n专业角色：${text(persona.specialty)}\n\n领域：${text(persona.category)}\n\n背景（画像设定，未经独立核实）：${text(persona.bio)}\n\n研究目标：${persona.goals.map(text).join("；")}\n\n关注议题：${persona.interests.map(text).join("；")}\n\n主要痛点：${persona.pain_points.map(text).join("；")}\n\n典型建议（画像设定）：${text(persona.typical_advice)}\n\n材料边界：该内容来自静态模拟画像库，仅用于模拟研究，不可作为独立真人证据。`)}><Plus className="size-4" aria-hidden />添加画像</Button></article>)}</div><div className="mt-4 flex items-center justify-end gap-3 text-sm"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页画像</Button><span>第 {page} / {pageCount} 页</span><Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页画像</Button></div></> : !visible.length ? <div className="py-8 text-center text-sm text-muted-foreground"><p>没有匹配的专家</p><p className="mt-1">请调整搜索或领域。</p></div> : null}
      </section>
      <aside className="rounded-xl border border-border p-5"><h3 className="text-xl font-semibold">已选择专家 {selected.length}</h3><div className="mt-4 space-y-3">{selected.map((entry, index) => <article key={entry.id} className="rounded-lg border border-border p-3"><div className="flex items-center gap-2"><SelectedAvatar id={entry.id} name={entry.name} directory={directory} context={avatarContext} savedIds={savedExpertIds} /><strong className="min-w-0 flex-1 text-sm">{entry.name}</strong><Button variant="ghost" size="icon" disabled={pending} aria-label={`移除专家 ${entry.name}`} onClick={() => onChange(document.markdown.slice(0, entry.block.start) + document.markdown.slice(entry.block.end))}><Trash2 className="size-4" aria-hidden /></Button></div><div className="mt-2 flex gap-2"><Button variant="ghost" size="sm" disabled={pending || index === 0} aria-label={`上移专家 ${entry.name}`} onClick={() => move(index, -1)}><ArrowUp className="size-4" aria-hidden /></Button><Button variant="ghost" size="sm" disabled={pending || index === selected.length - 1} aria-label={`下移专家 ${entry.name}`} onClick={() => move(index, 1)}><ArrowDown className="size-4" aria-hidden /></Button></div></article>)}</div><p className="mt-4 text-xs leading-6 text-muted-foreground">专家绑定稳定 ID；专家库头像在登录后保存到当前账号，跨会话同步。</p></aside>
    </div>
    {showRecoveryContext && document.markdown.trim() ? <section data-testid="itv-expert-draft-context" className="mt-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground"><h3 className="font-semibold text-foreground">生成中断：已保存的未确认画像</h3><p className="mt-1">请核对完整草稿及材料边界，再保存或继续生成；解析出的专家名称不代表全文已完成。</p><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-xs leading-6">{document.markdown}</pre></section> : !selected.length && document.markdown.trim() ? <p data-testid="itv-expert-draft-context" className="mt-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">已保存的画像草稿：{document.markdown.slice(0, 160)}</p> : null}
    <footer className="mt-6 flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={pending} onClick={onGenerate}>生成专家建议</Button><Button variant="outline" disabled={pending || !document.markdown.trim()} onClick={onSave}>保存专家草稿</Button><Button variant="primary" disabled={pending || !selected.length} onClick={onConfirm}>确认专家并生成问题</Button></footer>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto p-6">
      <div className="flex items-center gap-4"><ExpertAvatar expertId="virtual-preview" displayName={name || "虚拟专家"} /><div><DialogTitle className="text-2xl">添加虚拟专家</DialogTitle><DialogDescription className="mt-1 text-sm leading-6">用 Markdown 描述专业角色，并在加入访谈前审阅模拟边界；不编造真人任职或研究经历。</DialogDescription></div></div>
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <section className="space-y-4 rounded-xl border border-border p-5">
          <h3 className="text-lg font-semibold">1 · 编辑专家画像</h3>
          <label className="block text-sm font-medium">专家名称<input aria-label="专家名称" value={name} onChange={(event) => { setName(event.target.value); setReviewed(false); }} placeholder="例如：采购决策流程研究员" className="mt-2 w-full rounded-lg border border-input bg-background p-3 font-normal" /></label>
          <label className="block text-sm font-medium">专家画像 Markdown<textarea aria-label="专家画像 Markdown" value={profile} onChange={(event) => { setProfile(event.target.value); setReviewed(false); }} placeholder="## 专业领域\n\n## 可以回答的问题\n\n## 材料边界与不确定性" className="mt-2 min-h-64 w-full rounded-lg border border-input bg-background p-3 font-normal leading-7" /></label>
          <p className="text-xs leading-5 text-muted-foreground">此处仅保存您审阅后的 Markdown；模拟专家意见不计作独立真人证据。</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} className="mt-1" />已审阅画像及模拟边界</label>
        </section>
        <aside data-testid="itv-virtual-expert-preview-card" className="rounded-xl border border-border bg-muted/20 p-5">
          <h3 className="text-lg font-semibold">2 · 专家预览</h3>
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-card p-3"><ExpertAvatar expertId="virtual-preview" displayName={name || "虚拟专家"} /><div className="min-w-0"><strong className="block truncate">{name || "待命名的虚拟专家"}</strong><span className="text-xs text-muted-foreground">虚拟专家 · 仅用于模拟访谈</span></div></div>
          {profile.trim() ? <InterviewReportMarkdown markdown={profile} testId="itv-virtual-expert-preview" /> : <p className="mt-5 text-sm leading-6 text-muted-foreground">填写左侧 Markdown 后在这里预览，确认专业范围与局限。</p>}
          <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">虚拟专家由当前研究的已知材料约束，不代表真实受访者或新的独立证据。</p>
        </aside>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button variant="primary" disabled={pending || !reviewed || !name.trim() || !profile.trim()} onClick={() => { append(`virtual-${crypto.randomUUID()}`, name, profile); setOpen(false); }}>保存并添加专家</Button></div>
    </DialogContent></Dialog>
  </div>;
}
