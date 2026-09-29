"use client";
import * as React from "react";
import { Plus, Sparkles, Bot, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialsOf } from "@/lib/home-format";
import { listAgentDirectory, type AgentDirectoryCard } from "@/lib/agent-directory";
import { listSkills, type SkillListItem } from "@/lib/live-skill";
import type { RecommendedAgent, RecommendedCapability } from "@/lib/live-home-config";
import type { HomeConfigFormState } from "./home-config-form-model";

type Props = { form: HomeConfigFormState; onChange: (next: HomeConfigFormState) => void };
const SECTION = "flex flex-col gap-3 rounded-lg border border-border bg-panel p-4";
export const MAX_RECOMMENDED = 6;

type Catalog<T> = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ready"; items: readonly T[] };

function useCatalog<T>(open: boolean, load: () => Promise<readonly T[]>): Catalog<T> {
  const [state, setState] = React.useState<Catalog<T>>({ status: "idle" });
  const loadRef = React.useRef(load);
  loadRef.current = load;
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: "loading" });
    loadRef.current()
      .then((items) => { if (!cancelled) setState({ status: "ready", items }); })
      .catch(() => { if (!cancelled) setState({ status: "error" }); });
    return () => { cancelled = true; };
  }, [open]);
  return state;
}

function PickerShell<T>({
  catalog, emptyHint, render,
}: { catalog: Catalog<T>; emptyHint: string; render: (items: readonly T[]) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-card p-3" data-testid="home-config-picker">
      {catalog.status === "loading" ? <p className="text-11 text-muted-foreground">加载目录…</p> : null}
      {catalog.status === "error" ? <p className="text-11 text-destructive">目录加载失败，请稍后重试。</p> : null}
      {catalog.status === "ready" && catalog.items.length === 0 ? <p className="text-11 text-muted-foreground">{emptyHint}</p> : null}
      {catalog.status === "ready" && catalog.items.length > 0 ? render(catalog.items) : null}
    </div>
  );
}

const CHIP =
  "rounded-control border border-border-subtle bg-panel px-2 py-1 text-11 text-card-foreground transition-colors duration-fast hover:bg-muted disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground";

/** 推荐数字人（最多 6 个，带头像）。候选来自成员可读的 Agent 目录（只含已发布、对你可见的）。 */
export function RecommendedAgentsSection({ form, onChange }: Props) {
  const [open, setOpen] = React.useState(false);
  const catalog = useCatalog<AgentDirectoryCard>(open, () => listAgentDirectory());
  const picked = new Set(form.recommendedAgents.map((a) => a.agentId));
  const atMax = form.recommendedAgents.length >= MAX_RECOMMENDED;

  const add = (c: AgentDirectoryCard) => {
    if (atMax || picked.has(c.agentId)) return;
    const next: RecommendedAgent = { agentId: c.agentId, name: c.name, roleLabel: c.roleLabel || null, avatarKey: c.avatar?.key ?? null, note: null };
    onChange({ ...form, recommendedAgents: [...form.recommendedAgents, next] });
  };
  const remove = (id: string) => onChange({ ...form, recommendedAgents: form.recommendedAgents.filter((a) => a.agentId !== id) });
  const setNote = (id: string, note: string) =>
    onChange({ ...form, recommendedAgents: form.recommendedAgents.map((a) => (a.agentId === id ? { ...a, note: note.length > 0 ? note : null } : a)) });

  return (
    <section className={SECTION} data-testid="home-config-agents">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-13 font-semibold text-card-foreground">推荐数字人（最多 {MAX_RECOMMENDED} 个）</h2>
        <Button type="button" size="sm" variant="outline" disabled={atMax} onClick={() => setOpen((v) => !v)} data-testid="home-config-add-agent">
          <Plus aria-hidden className="h-3.5 w-3.5" />添加数字人
        </Button>
      </div>
      {form.recommendedAgents.length === 0 ? <p className="text-11 text-muted-foreground">还没有推荐数字人。</p> : (
        <ul className="flex flex-col gap-2">
          {form.recommendedAgents.map((a) => (
            <li key={a.agentId} className="flex items-start gap-2 rounded-card border border-border-subtle bg-card p-2.5" data-testid={`home-config-agent-${a.agentId}`}>
              <Avatar initials={initialsOf(a.name)} avatarKey={a.avatarKey} tone="ai" size="lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-12 font-medium text-card-foreground">{a.name}{a.roleLabel ? <span className="ml-1.5 text-11 font-normal text-muted-foreground">{a.roleLabel}</span> : null}</span>
                <Input value={a.note ?? ""} placeholder="一句话介绍（可选，最多 80 字）" maxLength={80} onChange={(e) => setNote(a.agentId, e.target.value)} data-testid={`home-config-agent-note-${a.agentId}`} />
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label={`移除 ${a.name}`} onClick={() => remove(a.agentId)} data-testid={`home-config-agent-remove-${a.agentId}`}>
                <X aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <PickerShell
          catalog={catalog}
          emptyHint="本组织还没有已发布的数字人。"
          render={(items) => (
            <div className="flex flex-wrap gap-1.5">
              {items.map((c) => (
                <button key={c.agentId} type="button" disabled={picked.has(c.agentId) || atMax} onClick={() => add(c)} data-testid={`home-config-picker-agent-${c.agentId}`} className={CHIP}>
                  {picked.has(c.agentId) ? `已添加 · ${c.name}` : c.name}
                </button>
              ))}
            </div>
          )}
        />
      ) : null}
    </section>
  );
}

/** 组织推荐 Skill（最多 6 个）。首页点击会新建对话并自动加载该 Skill。 */
export function RecommendedSkillsSection({ orgId, form, onChange }: Props & { orgId: string }) {
  const [open, setOpen] = React.useState(false);
  const catalog = useCatalog<SkillListItem>(open, async () => (await listSkills(orgId)).filter((s) => s.status === "已启用"));
  const key = (c: RecommendedCapability) => `${c.kind}-${c.refId}`;
  const picked = new Set(form.recommendedCapabilities.map(key));
  const atMax = form.recommendedCapabilities.length >= MAX_RECOMMENDED;

  const add = (s: SkillListItem) => {
    if (atMax) return;
    onChange({ ...form, recommendedCapabilities: [...form.recommendedCapabilities, { kind: "skill", refId: s.skillId, name: s.name, note: null }] });
  };
  const remove = (c: RecommendedCapability) => onChange({ ...form, recommendedCapabilities: form.recommendedCapabilities.filter((x) => key(x) !== key(c)) });
  const setNote = (c: RecommendedCapability, note: string) =>
    onChange({ ...form, recommendedCapabilities: form.recommendedCapabilities.map((x) => (key(x) === key(c) ? { ...x, note: note.length > 0 ? note : null } : x)) });

  return (
    <section className={SECTION} data-testid="home-config-skills">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-13 font-semibold text-card-foreground">推荐 Skill（最多 {MAX_RECOMMENDED} 个）</h2>
        <Button type="button" size="sm" variant="outline" disabled={atMax} onClick={() => setOpen((v) => !v)} data-testid="home-config-add-recommendation">
          <Plus aria-hidden className="h-3.5 w-3.5" />添加 Skill
        </Button>
      </div>
      <p className="text-11 text-muted-foreground">成员在首页点击后，会新建一个对话并自动加载这个 Skill。</p>
      {form.recommendedCapabilities.length === 0 ? <p className="text-11 text-muted-foreground">还没有推荐 Skill。</p> : (
        <ul className="flex flex-col gap-2">
          {form.recommendedCapabilities.map((c) => (
            <li key={key(c)} className="flex items-start gap-2 rounded-card border border-border-subtle bg-card p-2.5" data-testid={`home-config-recommendation-${c.kind}-${c.refId}`}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control bg-ai-tint text-ai">
                {c.kind === "agent" ? <Bot aria-hidden className="h-3.5 w-3.5" /> : <Sparkles aria-hidden className="h-3.5 w-3.5" />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-12 font-medium text-card-foreground">{c.name}</span>
                <Input value={c.note ?? ""} placeholder="备注（可选，最多 80 字）" maxLength={80} onChange={(e) => setNote(c, e.target.value)} data-testid={`home-config-recommendation-note-${c.kind}-${c.refId}`} />
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label={`移除 ${c.name}`} onClick={() => remove(c)} data-testid={`home-config-remove-${c.kind}-${c.refId}`}>
                <X aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <PickerShell
          catalog={catalog}
          emptyHint="本组织还没有已启用的 Skill。"
          render={(items) => (
            <div className="flex flex-wrap gap-1.5">
              {items.map((s) => (
                <button key={s.skillId} type="button" disabled={picked.has(`skill-${s.skillId}`) || atMax} onClick={() => add(s)} data-testid={`home-config-picker-skill-${s.skillId}`} className={CHIP}>
                  {picked.has(`skill-${s.skillId}`) ? `已添加 · ${s.name}` : s.name}
                </button>
              ))}
            </div>
          )}
        />
      ) : null}
    </section>
  );
}
