"use client";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { GateStatusPanel } from "@/components/work-stack/gate-status-panel";
import { DeniedState, EmptyState, LoadingSkeleton } from "@/components/work-stack/states";
import {
  DOMAINS,
  RISK_LABEL,
  WORK_SKILLS,
  type PreviewState,
  type Readiness,
  type SkillChannel,
  type SkillDep,
  type WorkSkill,
} from "@/lib/mock/work-stack";

function readinessBadge(r: Readiness, missing?: number) {
  if (r === "ready") return <Badge tone="success" data-testid="work-catalog-readiness-badge">可运行</Badge>;
  if (r === "not_ready")
    return <Badge tone="warning" data-testid="work-catalog-readiness-badge">缺 {missing ?? 1} 项</Badge>;
  return (
    <Badge tone="outline" data-testid="work-catalog-readiness-badge">
      未知
    </Badge>
  );
}

function DepRow({ dep }: { dep: SkillDep }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-control border border-border/60 px-3 py-2">
      <div>
        <p className="text-12 text-background-foreground">
          {dep.name} <span className="text-muted-foreground">· {dep.stableId}</span>
        </p>
        {dep.reason && (
          <p className="mt-0.5 text-11 text-muted-foreground">
            {dep.optional ? "可选，未授权，功能降级：" : ""}
            {dep.reason}
          </p>
        )}
      </div>
      {dep.readiness === "ready" ? (
        <Badge tone="success">就绪</Badge>
      ) : dep.readiness === "not_ready" ? (
        <Badge tone="warning">未就绪</Badge>
      ) : (
        <Badge tone="outline" data-testid="work-catalog-readiness-unknown">
          未知
        </Badge>
      )}
    </li>
  );
}

function SkillDetail({ skill, state, isAdmin }: { skill: WorkSkill; state: PreviewState; isAdmin: boolean }) {
  return (
    <aside
      data-testid="work-skill-detail"
      className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4"
    >
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-14 font-bold text-background-foreground">{skill.name}</h2>
          {skill.deprecated && <Badge tone="danger">已废弃</Badge>}
        </div>
        <p className="text-11 text-muted-foreground">
          {skill.stableId} · {skill.domain} · {RISK_LABEL[skill.riskClass]}
        </p>
        <p className="text-12 text-muted-foreground">{skill.summary}</p>
      </header>

      {skill.successor && (
        <div
          data-testid="work-skill-successor"
          className="rounded-control bg-warning/15 px-3 py-2 text-12 text-warning-foreground"
        >
          已由后继 Skill 取代：{skill.successor.name}（{skill.successor.stableId}）
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-12 font-medium text-background-foreground">必需依赖</h3>
        <ul data-testid="work-skill-deps-required" className="flex flex-col gap-1.5">
          {skill.requiredDeps.length ? (
            skill.requiredDeps.map((d) => <DepRow key={d.stableId} dep={d} />)
          ) : (
            <li className="text-11 text-muted-foreground">无</li>
          )}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-12 font-medium text-background-foreground">可选依赖</h3>
        <ul data-testid="work-skill-deps-optional" className="flex flex-col gap-1.5">
          {skill.optionalDeps.length ? (
            skill.optionalDeps.map((d) => <DepRow key={d.stableId} dep={d} />)
          ) : (
            <li className="text-11 text-muted-foreground">无</li>
          )}
        </ul>
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h3 className="text-12 font-medium text-background-foreground">门状态（G0–G5）</h3>
        <GateStatusPanel gates={skill.gates} state={state} isPlatformOperator={isAdmin} />
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h3 className="text-12 font-medium text-background-foreground">溯源</h3>
        <dl data-testid="work-skill-provenance" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-12">
          {skill.provenance.map((p) => (
            <React.Fragment key={p.field}>
              <dt className="text-muted-foreground">{p.field}</dt>
              <dd className="text-background-foreground">{p.value}</dd>
            </React.Fragment>
          ))}
          <dt className="text-muted-foreground">地区</dt>
          <dd className="text-background-foreground">{skill.region}</dd>
          <dt className="text-muted-foreground">法域</dt>
          <dd className="text-background-foreground">{skill.jurisdiction}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-12 font-medium text-background-foreground">版本</h3>
        <ul data-testid="work-skill-versions" className="flex flex-col gap-1">
          {skill.versions.map((v) => (
            <li key={v.label} className="flex items-center justify-between text-12">
              <span className="text-background-foreground">{v.label}</span>
              <span className="text-11 text-muted-foreground">{v.note}</span>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-11 text-muted-foreground">管理员操作</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" data-testid="work-skill-change-channel">
              切换通道
            </Button>
            <Button size="sm" variant="outline" data-testid="work-skill-set-successor">
              设置后继
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}

const CHANNELS: readonly { key: SkillChannel; label: string }[] = [
  { key: "candidate", label: "候选" },
  { key: "verified", label: "已验证" },
];

export function SkillCatalogScreen({
  state,
  isAdmin,
}: {
  state: PreviewState;
  isAdmin: boolean;
}) {
  const [channel, setChannel] = React.useState<SkillChannel | "all">("all");
  const [domain, setDomain] = React.useState<string>("all");
  const [includeDeprecated, setIncludeDeprecated] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string>("S003");

  if (state === "denied") {
    return (
      <div data-testid="work-catalog-screen" className="p-6">
        <DeniedState testid="work-catalog-denied" />
      </div>
    );
  }

  // invalid 态：用来演示 depfail（门加载失败）在抽屉里的局部呈现，主列表照常。
  const drawerState: PreviewState = state === "depfail" || state === "invalid" ? "depfail" : state;

  const rows = WORK_SKILLS.filter((s) => {
    if (channel !== "all" && s.channel !== channel) return false;
    if (domain !== "all" && s.domain !== domain) return false;
    if (!includeDeprecated && s.deprecated) return false;
    if (query && !`${s.name}${s.stableId}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const selected = WORK_SKILLS.find((s) => s.stableId === selectedId) ?? rows[0] ?? WORK_SKILLS[0];
  const listEmpty = state === "empty" || rows.length === 0;

  return (
    <div data-testid="work-catalog-screen" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <h1 className="text-14 font-bold text-background-foreground">Work Skill 目录</h1>
        <div className="ml-auto w-64">
          <Input
            data-testid="work-catalog-search"
            placeholder="搜索名称或 stableId…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索 Skill"
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左栏筛选 */}
        <nav className="flex w-52 shrink-0 flex-col gap-4 border-r border-border p-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-11 font-medium uppercase tracking-wide text-muted-foreground">领域</p>
            <div data-testid="work-catalog-domain-filter" className="flex flex-col gap-1">
              <button
                onClick={() => setDomain("all")}
                className={`rounded-control px-2 py-1 text-left text-12 transition-colors hover:bg-muted ${
                  domain === "all" ? "bg-muted font-medium text-background-foreground" : "text-muted-foreground"
                }`}
              >
                全部领域
              </button>
              {DOMAINS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDomain(d)}
                  className={`rounded-control px-2 py-1 text-left text-12 transition-colors hover:bg-muted ${
                    domain === d ? "bg-muted font-medium text-background-foreground" : "text-muted-foreground"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-11 font-medium uppercase tracking-wide text-muted-foreground">通道</p>
            {CHANNELS.map((c) => (
              <button
                key={c.key}
                data-testid={`work-catalog-channel-${c.key}`}
                onClick={() => setChannel(channel === c.key ? "all" : c.key)}
                className={`rounded-control px-2 py-1 text-left text-12 transition-colors hover:bg-muted ${
                  channel === c.key ? "bg-muted font-medium text-background-foreground" : "text-muted-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <Checkbox
            data-testid="work-catalog-include-deprecated"
            label="显示已废弃"
            checked={includeDeprecated}
            onChange={(e) => setIncludeDeprecated(e.target.checked)}
          />
        </nav>

        {/* 列表 */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {state === "loading" ? (
            <LoadingSkeleton testid="work-catalog-state-loading" />
          ) : listEmpty ? (
            <EmptyState
              testid="work-catalog-state-empty"
              message="没有符合条件的 Skill。调整筛选或清除条件后再试。"
              actionLabel="清除筛选"
              actionTestid="work-catalog-clear-filters"
              onAction={() => {
                setChannel("all");
                setDomain("all");
                setIncludeDeprecated(false);
                setQuery("");
              }}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((s) => (
                <li key={s.stableId}>
                  <button
                    data-testid={`work-catalog-row-${s.stableId}`}
                    onClick={() => setSelectedId(s.stableId)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted ${
                      selected?.stableId === s.stableId ? "border-primary bg-muted" : "border-border"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-13 font-medium text-background-foreground">
                        {s.name}
                        <span className="ml-2 text-11 font-normal text-muted-foreground">{s.stableId}</span>
                      </p>
                      <p className="mt-0.5 truncate text-11 text-muted-foreground">{s.summary}</p>
                    </div>
                    <Badge tone="outline">{s.domain}</Badge>
                    <Badge tone={s.channel === "verified" ? "primary" : "neutral"} data-testid="work-catalog-channel-badge">
                      {s.channel === "verified" ? "已验证" : "候选"}
                    </Badge>
                    <span className="text-11 text-muted-foreground">{RISK_LABEL[s.riskClass]}</span>
                    {readinessBadge(s.readiness, s.readinessMissingCount)}
                    <span data-testid="work-catalog-gate-summary" className="text-11 text-muted-foreground">
                      G4✓ G5{s.gates.cells.find((c) => c.gate === "G5")?.state === "pass" ? "✓" : "✗"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 详情抽屉 */}
        {!listEmpty && state !== "loading" && selected && (
          <SkillDetail skill={selected} state={drawerState} isAdmin={isAdmin} />
        )}
      </div>
    </div>
  );
}
