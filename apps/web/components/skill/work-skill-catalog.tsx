"use client";

import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  WORK_SKILL_CHANNEL_TRANSITIONS,
  getWorkSkillCatalogEntry,
  getWorkSkillReadiness,
  listWorkSkillCatalog,
  updateWorkSkillCatalogEntry,
  type WorkSkillCatalogDetail,
  type WorkSkillCatalogItem,
  type WorkSkillChannel,
  type WorkSkillReadiness,
} from "@/lib/live-work-skill";

/**
 * WS05 —— `/skill?screen=work-catalog` Work Skill 目录屏（R8；契约束 `work-skill-meta` ui.md）。
 *
 * 接真实后端 `GET /skills/catalog` / `GET /skills/catalog/:skillId` / `.../readiness` /
 * `PATCH /admin/skills/catalog/:skillId`。本屏只画契约给出的字段：
 *   · 就绪性 unknown（E5）绝不显示为 ready，只做局部提示，其余字段照常；
 *   · 空态（E7）给清除筛选入口，不回退到无关结果；
 *   · 管理员入口只看服务端给的 `canManageChannel`（E9），不在前端复述权限规则。
 */

const CHANNEL_LABEL: Record<WorkSkillChannel, string> = {
  candidate: "候选",
  verified: "已验证",
  deprecated: "已废弃",
};
const CHANNEL_TONE = { candidate: "primary", verified: "success", deprecated: "danger" } as const;
const RISK_LABEL = { low: "低风险", medium: "中风险", high: "高风险" } as const;

type ChannelFilter = "candidate" | "verified" | null;

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: readonly WorkSkillCatalogItem[] };

function errorText(e: unknown): string {
  if (e instanceof ApiError) return `${e.reasonCode ?? "请求失败"}（HTTP ${e.status}）`;
  return e instanceof Error ? e.message : String(e);
}

function ReadinessBadge({ readiness }: { readiness: WorkSkillCatalogItem["readiness"] }) {
  if (readiness.overall === "ready")
    return <Badge tone="success" data-testid="work-catalog-readiness-badge">可运行</Badge>;
  if (readiness.overall === "not_ready")
    return (
      <Badge tone="warning" data-testid="work-catalog-readiness-badge">
        缺 {readiness.missingRequired ?? 0} 项
      </Badge>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone="outline" data-testid="work-catalog-readiness-badge">未知</Badge>
      <span data-testid="work-catalog-readiness-unknown" className="text-11 text-muted-foreground">
        就绪性暂无法确认
      </span>
    </span>
  );
}

export function WorkSkillCatalog() {
  const { session } = useSession();
  if (!session?.currentOrgId) {
    return (
      <div
        data-testid="work-catalog-signed-out"
        className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
      >
        Work Skill 目录需要先登录。
      </div>
    );
  }
  return <CatalogScreen />;
}

function CatalogScreen() {
  const [domain, setDomain] = React.useState<string>("");
  const [channel, setChannel] = React.useState<ChannelFilter>(null);
  const [includeDeprecated, setIncludeDeprecated] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [state, setState] = React.useState<ListState>({ status: "loading" });
  const [domains, setDomains] = React.useState<readonly string[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const generation = React.useRef(0);

  const load = React.useCallback(async () => {
    const request = ++generation.current;
    setState({ status: "loading" });
    try {
      const out = await listWorkSkillCatalog({
        domain: domain || undefined,
        channel: channel ?? undefined,
        q,
        includeDeprecated,
      });
      if (request !== generation.current) return;
      setState({ status: "ready", items: out.items });
      setDomains((prev) => Array.from(new Set([...prev, ...out.items.map((i) => i.domain)])).sort());
    } catch (e) {
      if (request !== generation.current) return;
      setState({ status: "error", message: errorText(e) });
    }
  }, [domain, channel, q, includeDeprecated]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const clearFilters = () => {
    setDomain("");
    setChannel(null);
    setIncludeDeprecated(false);
    setQ("");
  };

  return (
    <div data-testid="work-catalog-screen" className="flex h-full min-h-0 gap-4">
      <aside className="flex w-48 shrink-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="work-catalog-domain">领域</Label>
          <select
            id="work-catalog-domain"
            data-testid="work-catalog-domain-filter"
            className="rounded-control border border-border bg-background px-2 py-1 text-12"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          >
            <option value="">全部领域</option>
            {domains.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-12 font-medium">通道</span>
          {(["candidate", "verified"] as const).map((c) => (
            <Button
              key={c}
              size="sm"
              variant={channel === c ? "primary" : "outline"}
              data-testid={`work-catalog-channel-${c}`}
              aria-pressed={channel === c}
              onClick={() => setChannel(channel === c ? null : c)}
            >
              {CHANNEL_LABEL[c]}
            </Button>
          ))}
        </div>
        <Checkbox
          data-testid="work-catalog-include-deprecated"
          checked={includeDeprecated}
          onChange={(e) => setIncludeDeprecated(e.target.checked)}
          label="显示已废弃"
        />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <Input
          data-testid="work-catalog-search"
          placeholder="搜索名称 / stableId / 领域 / 描述"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {state.status === "loading" && (
          <div data-testid="work-catalog-state-loading" className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-control bg-muted" />
            ))}
          </div>
        )}
        {state.status === "error" && (
          <div data-testid="work-catalog-state-error" className="flex items-center gap-3 text-12 text-destructive">
            目录读取失败：{state.message}
            <Button size="sm" variant="outline" onClick={() => void load()}>重试</Button>
          </div>
        )}
        {state.status === "ready" && state.items.length === 0 && (
          <div
            data-testid="work-catalog-state-empty"
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-12 text-muted-foreground"
          >
            没有符合条件的 Work Skill。
            <Button size="sm" variant="outline" data-testid="work-catalog-clear-filters" onClick={clearFilters}>
              清除筛选
            </Button>
          </div>
        )}
        {state.status === "ready" && state.items.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {state.items.map((item) => (
              <li key={item.skillId}>
                <button
                  type="button"
                  data-testid={`work-catalog-row-${item.stableId}`}
                  onClick={() => setSelected(item.skillId)}
                  className="flex w-full flex-wrap items-center gap-2 rounded-control border border-border px-3 py-2 text-left text-12 transition-colors duration-fast hover:bg-muted"
                >
                  <span className="font-medium">{item.name}</span>
                  <span className="text-muted-foreground">{item.stableId}</span>
                  <Badge tone="outline">{item.domain}</Badge>
                  <Badge tone={CHANNEL_TONE[item.channel]} data-testid="work-catalog-channel-badge">
                    {CHANNEL_LABEL[item.channel]}
                  </Badge>
                  <span className="text-muted-foreground">{RISK_LABEL[item.riskClass]}</span>
                  <ReadinessBadge readiness={item.readiness} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <SkillDetailDrawer
          key={selected}
          skillId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

type DetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: WorkSkillCatalogDetail };

type ReadinessState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; readiness: WorkSkillReadiness };

const DEP_STATE_LABEL = { satisfied: "已满足", missing: "缺失", denied: "已拒绝", unknown: "未知" } as const;

function SkillDetailDrawer({
  skillId, onClose, onChanged,
}: { skillId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = React.useState<DetailState>({ status: "loading" });
  const [readiness, setReadiness] = React.useState<ReadinessState>({ status: "loading" });

  const loadDetail = React.useCallback(async () => {
    try {
      setDetail({ status: "ready", detail: await getWorkSkillCatalogEntry(skillId) });
    } catch (e) {
      setDetail({ status: "error", message: errorText(e) });
    }
  }, [skillId]);

  React.useEffect(() => {
    void loadDetail();
    getWorkSkillReadiness(skillId).then(
      (r) => setReadiness({ status: "ready", readiness: r }),
      (e: unknown) => setReadiness({ status: "error", message: errorText(e) }),
    );
  }, [skillId, loadDetail]);

  return (
    <aside
      data-testid="work-skill-detail"
      className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4 text-12"
    >
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
      </div>
      {detail.status === "loading" && <p className="text-muted-foreground">加载中…</p>}
      {detail.status === "error" && <p className="text-destructive">详情读取失败：{detail.message}</p>}
      {detail.status === "ready" && (
        <DetailBody
          detail={detail.detail}
          readiness={readiness}
          onChanged={() => {
            void loadDetail();
            onChanged();
          }}
        />
      )}
    </aside>
  );
}

function DepList({
  testid, categories, readiness, optional,
}: {
  testid: string;
  categories: readonly string[];
  readiness: ReadinessState;
  optional: boolean;
}) {
  const items = readiness.status === "ready" ? readiness.readiness.items : [];
  return (
    <ul data-testid={testid} className="flex flex-col gap-1.5">
      {categories.length === 0 && <li className="text-muted-foreground">无</li>}
      {categories.map((c) => {
        const item = items.find((i) => i.category === c);
        const st = item?.state ?? "unknown";
        return (
          <li key={c} className="flex items-start justify-between gap-2 rounded-control border border-border/60 px-2 py-1.5">
            <div>
              <p>{c}</p>
              {item && item.reasonCode !== "OK" && (
                <p className="text-11 text-muted-foreground">
                  {optional && st !== "satisfied" ? "可选，未授权，功能降级 · " : ""}
                  {item.reasonCode}
                  {item.grantHref && (
                    <a className="ml-1 underline" href={item.grantHref}>去授权</a>
                  )}
                </p>
              )}
            </div>
            <Badge tone={st === "satisfied" ? "success" : st === "unknown" ? "outline" : "warning"}>
              {DEP_STATE_LABEL[st]}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

function DetailBody({
  detail, readiness, onChanged,
}: { detail: WorkSkillCatalogDetail; readiness: ReadinessState; onChanged: () => void }) {
  const m = detail.manifest;
  const readinessUnknown =
    readiness.status === "error" || (readiness.status === "ready" && readiness.readiness.overall === "unknown");
  return (
    <>
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-14 font-bold">{detail.name}</h2>
          <Badge tone={CHANNEL_TONE[detail.channel]}>{CHANNEL_LABEL[detail.channel]}</Badge>
        </div>
        <p className="text-11 text-muted-foreground">
          {detail.stableId} · {detail.domain} · {RISK_LABEL[detail.riskClass]} · {detail.currentVersionLabel}
        </p>
        <p className="text-muted-foreground">{detail.description}</p>
      </header>

      {readinessUnknown && (
        <p data-testid="work-catalog-readiness-unknown" className="rounded-control bg-muted px-2 py-1 text-muted-foreground">
          就绪性未知：工具授权查询失败，暂不能判断是否可运行（不视为可运行）。
        </p>
      )}

      <section className="flex flex-col gap-1">
        <h3 className="font-medium">必需依赖</h3>
        <DepList testid="work-skill-deps-required" categories={m.dependencies.required} readiness={readiness} optional={false} />
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="font-medium">可选依赖</h3>
        <DepList testid="work-skill-deps-optional" categories={m.dependencies.optional} readiness={readiness} optional />
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="font-medium">溯源</h3>
        <table data-testid="work-skill-provenance" className="w-full text-11">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>repo</th><th>path</th><th>commit</th><th>license</th>
            </tr>
          </thead>
          <tbody>
            {m.provenance.map((p) => (
              <tr key={`${p.repo}/${p.path}@${p.commit}`}>
                <td>{p.repo}</td><td>{p.path}</td><td>{p.commit.slice(0, 7)}</td><td>{p.license}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-1" data-testid="work-skill-locales">
        <h3 className="font-medium">地区与法域</h3>
        <p>语言：{m.locales.join("、")}；法域：{m.jurisdictions.join("、")}</p>
      </section>

      <section className="flex flex-col gap-1" data-testid="work-skill-gates">
        <h3 className="font-medium">评测套件 {m.evalSuiteId} · 门状态</h3>
        {detail.gates.length === 0 ? (
          <p className="text-muted-foreground">门判定尚未运行（占位）</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {detail.gates.map((g) => (
              <li key={g.gate}>
                <Badge tone={g.state === "passed" ? "success" : g.state === "failed" ? "danger" : "outline"}>
                  {g.gate} · {g.state}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="font-medium">版本</h3>
        <ul data-testid="work-skill-versions">
          {detail.versions.map((v) => (
            <li key={v.skillVersionId}>
              {v.semanticLabel}
              {v.current ? "（当前）" : ""}
            </li>
          ))}
        </ul>
      </section>

      {detail.successor && (
        <p data-testid="work-skill-successor">
          后继：
          <a className="underline" href={`?screen=work-catalog#${detail.successor.skillId}`}>
            {detail.successor.name}（{detail.successor.stableId}）
          </a>
        </p>
      )}

      {detail.canManageChannel && <AdminActions detail={detail} onChanged={onChanged} />}
    </>
  );
}

function AdminActions({ detail, onChanged }: { detail: WorkSkillCatalogDetail; onChanged: () => void }) {
  const allowed = WORK_SKILL_CHANNEL_TRANSITIONS[detail.channel];
  const [target, setTarget] = React.useState<WorkSkillChannel | "">(allowed[0] ?? "");
  const [evidence, setEvidence] = React.useState("");
  const [successor, setSuccessor] = React.useState(detail.successorSkillId ?? "");
  const [message, setMessage] = React.useState<string | null>(null);

  async function submit(change: { channel?: WorkSkillChannel; successorSkillId?: string | null }) {
    setMessage(null);
    try {
      await updateWorkSkillCatalogEntry(detail.skillId, {
        expectedChannel: detail.channel,
        ...change,
        ...(change.channel === "verified" && evidence.trim() ? { gateEvidenceRef: evidence.trim() } : {}),
        idempotencyKey: window.crypto.randomUUID(),
      });
      setMessage("已保存");
      onChanged();
    } catch (e) {
      setMessage(`保存失败：${errorText(e)}`);
    }
  }

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="font-medium">管理</h3>
      {allowed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="目标通道"
            className="rounded-control border border-border bg-background px-2 py-1"
            value={target}
            onChange={(e) => setTarget(e.target.value as WorkSkillChannel)}
          >
            {allowed.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
            ))}
          </select>
          {target === "verified" && (
            <Input placeholder="门证据引用" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          )}
          <Button
            size="sm"
            data-testid="work-skill-change-channel"
            disabled={target === ""}
            onClick={() => target !== "" && void submit({ channel: target })}
          >
            变更通道
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input placeholder="后继 Skill ID" value={successor} onChange={(e) => setSuccessor(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          data-testid="work-skill-set-successor"
          onClick={() => void submit({ successorSkillId: successor.trim() || null })}
        >
          设置后继
        </Button>
      </div>
      {message && <p className="text-11 text-muted-foreground">{message}</p>}
    </section>
  );
}
