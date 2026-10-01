"use client";

import * as React from "react";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { z } from "zod";
import { ApiError } from "@/lib/api-client";
import { workSkillMeta } from "@repo/contracts";
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
import { WorkGateStatusPanel, WorkGateSummaryBadge } from "./work-gate-status";

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
  | {
      status: "ready";
      items: readonly WorkSkillCatalogItem[];
      nextCursor: string | null;
      loadingMore: boolean;
      moreError: string | null;
    };

/** 搜索框防抖（毫秒）：避免每个按键都打一次全文检索端点。 */
export const WORK_CATALOG_SEARCH_DEBOUNCE_MS = 250;
/** 领域选项种子最多翻页数（防服务端 cursor 异常时死循环）。 */
const DOMAIN_SEED_MAX_PAGES = 20;

function hashSkillId(): string | null {
  if (typeof window === "undefined") return null;
  const h = decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
  return h ? h : null;
}

/**
 * WS05 错误码 → 人话（单源；契约闭集 `WorkSkillImportError` | `WorkSkillCatalogError`）。
 * 漏一个编译不过——不落回原始 reasonCode 上屏，见 .harness/scripts/lint-user-facing-error-text.mjs。
 */
type WorkSkillErrorCode =
  | z.infer<typeof workSkillMeta.WorkSkillImportError>
  | z.infer<typeof workSkillMeta.WorkSkillCatalogError>;
const WORK_SKILL_ERROR_TEXT: Record<WorkSkillErrorCode, string> = {
  WORK_SKILL_MANIFEST_INVALID: "这个包的元数据格式不对",
  WORK_SKILL_CAPABILITY_UNREGISTERED: "用到了一个尚未登记的能力分类",
  WORK_SKILL_PROVENANCE_LICENSE_MISSING: "缺少来源与许可证信息",
  WORK_SKILL_STABLE_ID_CONFLICT: "这个 Skill 编号已经存在",
  UNAUTHENTICATED: "登录已过期，请重新登录",
  WORK_SKILL_NOT_FOUND: "这个 Skill 找不到了，可能已被删除",
  WORK_SKILL_ADMIN_REQUIRED: "只有组织管理员能做这个操作",
  WORK_SKILL_CHANNEL_TRANSITION_INVALID: "当前状态不允许这次通道变更",
  WORK_SKILL_SUCCESSOR_INVALID: "指定的后继 Skill 无效",
  WORK_SKILL_IDEMPOTENCY_CONFLICT: "这次操作已经处理过一次，结果不一致",
  VALIDATION_FAILED: "提交的内容没有通过校验",
};

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const known = e.reasonCode ? WORK_SKILL_ERROR_TEXT[e.reasonCode as WorkSkillErrorCode] : undefined;
    return known ?? `请求失败（HTTP ${e.status}）`;
  }
  return e instanceof Error ? e.message : "发生未知错误";
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
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [state, setState] = React.useState<ListState>({ status: "loading" });
  const [domains, setDomains] = React.useState<readonly string[]>([]);
  const [selected, setSelected] = React.useState<string | null>(() => hashSkillId());
  const generation = React.useRef(0);

  const mergeDomains = React.useCallback((items: readonly WorkSkillCatalogItem[]) => {
    setDomains((prev) => {
      const next = Array.from(new Set([...prev, ...items.map((i) => i.domain)])).sort();
      return next.length === prev.length ? prev : next;
    });
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), WORK_CATALOG_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // 后继链接 / 外部深链以 `#<skillId>` 指向某个 Skill：hash 变化即打开对应抽屉。
  React.useEffect(() => {
    const onHash = () => {
      const id = hashSkillId();
      if (id) setSelected(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openSkill = React.useCallback((skillId: string) => {
    setSelected(skillId);
    if (typeof window !== "undefined" && window.history?.replaceState) {
      window.history.replaceState(null, "", `#${encodeURIComponent(skillId)}`);
    }
  }, []);

  const query = React.useMemo(
    () => ({ domain: domain || undefined, channel: channel ?? undefined, q: debouncedQ, includeDeprecated }),
    [domain, channel, debouncedQ, includeDeprecated],
  );

  const load = React.useCallback(async () => {
    const request = ++generation.current;
    setState({ status: "loading" });
    try {
      const out = await listWorkSkillCatalog(query);
      if (request !== generation.current) return;
      setState({ status: "ready", items: out.items, nextCursor: out.nextCursor, loadingMore: false, moreError: null });
      mergeDomains(out.items);
    } catch (e) {
      if (request !== generation.current) return;
      setState({ status: "error", message: errorText(e) });
    }
  }, [query, mergeDomains]);

  const loadMore = React.useCallback(async () => {
    if (state.status !== "ready" || !state.nextCursor || state.loadingMore) return;
    const request = generation.current;
    const cursor = state.nextCursor;
    setState({ ...state, loadingMore: true, moreError: null });
    try {
      const out = await listWorkSkillCatalog({ ...query, cursor });
      if (request !== generation.current) return;
      setState((prev) =>
        prev.status === "ready"
          ? { status: "ready", items: [...prev.items, ...out.items], nextCursor: out.nextCursor, loadingMore: false, moreError: null }
          : prev,
      );
      mergeDomains(out.items);
    } catch (e) {
      if (request !== generation.current) return;
      setState((prev) => (prev.status === "ready" ? { ...prev, loadingMore: false, moreError: errorText(e) } : prev));
    }
  }, [state, query, mergeDomains]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // 领域选项来自不带筛选的全量翻页（含已废弃），而非当前筛选后的第一页。
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      let cursor: string | undefined;
      for (let page = 0; page < DOMAIN_SEED_MAX_PAGES && alive; page++) {
        try {
          const out = await listWorkSkillCatalog({ includeDeprecated: true, cursor });
          if (!alive) return;
          mergeDomains(out.items);
          if (!out.nextCursor) return;
          cursor = out.nextCursor;
        } catch {
          return; // 种子失败不影响主列表；选项仍会随已加载页累积。
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [mergeDomains]);

  const clearFilters = () => {
    setDomain("");
    setChannel(null);
    setIncludeDeprecated(false);
    setQ("");
    setDebouncedQ("");
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
                  onClick={() => openSkill(item.skillId)}
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
                  <WorkGateSummaryBadge skillId={item.skillId} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {state.status === "ready" && state.nextCursor && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              data-testid="work-catalog-load-more"
              disabled={state.loadingMore}
              onClick={() => void loadMore()}
            >
              {state.loadingMore ? "加载中…" : "加载更多"}
            </Button>
            {state.moreError && (
              <span data-testid="work-catalog-load-more-error" className="text-12 text-destructive">
                加载更多失败：{state.moreError}
              </span>
            )}
          </div>
        )}
      </section>

      {selected && (
        <SkillDetailDrawer
          key={selected}
          skillId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
          onOpenSkill={openSkill}
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

// 就绪原因码 → 用户可读文案。原始机读码（如 NO_ENABLED_TOOL）不得直接展示给终端用户，
// 只能收进下方折叠的“详情”里。closed set 与 packages/contracts/src/work-skill-meta.ts 的
// reasonCode 枚举保持一致。
const READINESS_REASON_LABEL: Record<string, string> = {
  OK: "已就绪",
  CATEGORY_UNREGISTERED: "该能力未在系统中注册",
  NO_ENABLED_TOOL: "未配置可用工具",
  GRANT_DENIED: "授权已被拒绝",
  GRANT_LOOKUP_FAILED: "授权状态查询失败",
};

function readinessReasonLabel(reasonCode: string): string {
  return READINESS_REASON_LABEL[reasonCode] ?? "暂不可用";
}

function SkillDetailDrawer({
  skillId, onClose, onChanged, onOpenSkill,
}: { skillId: string; onClose: () => void; onChanged: () => void; onOpenSkill: (skillId: string) => void }) {
  const [detail, setDetail] = React.useState<DetailState>({ status: "loading" });
  const [readiness, setReadiness] = React.useState<ReadinessState>({ status: "loading" });
  const detailGen = React.useRef(0);
  const readinessGen = React.useRef(0);

  const loadDetail = React.useCallback(async () => {
    const request = ++detailGen.current;
    try {
      const d = await getWorkSkillCatalogEntry(skillId);
      if (request === detailGen.current) setDetail({ status: "ready", detail: d });
    } catch (e) {
      if (request === detailGen.current) setDetail({ status: "error", message: errorText(e) });
    }
  }, [skillId]);

  const loadReadiness = React.useCallback(async () => {
    const request = ++readinessGen.current;
    try {
      const r = await getWorkSkillReadiness(skillId);
      if (request === readinessGen.current) setReadiness({ status: "ready", readiness: r });
    } catch (e) {
      if (request === readinessGen.current) setReadiness({ status: "error", message: errorText(e) });
    }
  }, [skillId]);

  React.useEffect(() => {
    void loadDetail();
    void loadReadiness();
    return () => {
      // 卸载 / 切换 skill 后作废在途请求，避免旧结果写回。
      // 这里只做单调自增、不读取"当前"值做判断，ref 在 effect 触发时是否已变化不影响正确性。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      detailGen.current++;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      readinessGen.current++;
    };
  }, [loadDetail, loadReadiness]);

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
          onOpenSkill={onOpenSkill}
          onChanged={() => {
            void loadDetail();
            void loadReadiness();
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
                <div className="text-11 text-muted-foreground">
                  <p>
                    {optional && st !== "satisfied" ? "可选，未授权，功能降级 · " : ""}
                    {readinessReasonLabel(item.reasonCode)}
                    {item.grantHref && (
                      <a className="ml-1 underline" href={item.grantHref}>去授权</a>
                    )}
                  </p>
                  <details className="mt-0.5">
                    <summary className="cursor-pointer select-none">详情</summary>
                    <span className="ml-1">{item.reasonCode}</span>
                  </details>
                </div>
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
  detail, readiness, onChanged, onOpenSkill,
}: {
  detail: WorkSkillCatalogDetail;
  readiness: ReadinessState;
  onChanged: () => void;
  onOpenSkill: (skillId: string) => void;
}) {
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
        <p data-testid="work-skill-detail-readiness-unknown" className="rounded-control bg-muted px-2 py-1 text-muted-foreground">
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

      <WorkGateStatusPanel skillId={detail.skillId} />

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
          <a
            className="underline"
            data-testid="work-skill-successor-link"
            href={`?screen=work-catalog#${encodeURIComponent(detail.successor.skillId)}`}
            onClick={(e) => {
              e.preventDefault();
              if (detail.successor) onOpenSkill(detail.successor.skillId);
            }}
          >
            {detail.successor.name}（{detail.successor.stableId}）
          </a>
        </p>
      )}

      {detail.canManageChannel && (
        // key 绑当前通道/后继：PATCH 成功后详情重载，控件本地态（目标通道/证据/后继）随之重置，
        // 避免拿旧 target 与新 expectedChannel 组出不合法的转移。
        <AdminActions
          key={`${detail.skillId}:${detail.channel}:${detail.successorSkillId ?? ""}`}
          detail={detail}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function AdminActions({ detail, onChanged }: { detail: WorkSkillCatalogDetail; onChanged: () => void }) {
  const allowed = WORK_SKILL_CHANNEL_TRANSITIONS[detail.channel];
  const [target, setTarget] = React.useState<WorkSkillChannel | "">(allowed[0] ?? "");
  const [evidence, setEvidence] = React.useState("");
  const [successor, setSuccessor] = React.useState(detail.successorSkillId ?? "");
  const [message, setMessage] = React.useState<string | null>(null);
  // R3 步 9：门判定上线前，转 verified 必须带 gateEvidenceRef —— 提交前就拦下，而不是等服务端 409。
  const evidenceMissing = target === "verified" && evidence.trim() === "";

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
            <Input
              data-testid="work-skill-gate-evidence"
              placeholder="门证据引用（必填）"
              aria-required
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          )}
          {evidenceMissing && (
            <span data-testid="work-skill-gate-evidence-required" className="text-11 text-destructive">
              转为已验证需填写门证据引用
            </span>
          )}
          <Button
            size="sm"
            data-testid="work-skill-change-channel"
            disabled={target === "" || evidenceMissing}
            onClick={() => target !== "" && !evidenceMissing && void submit({ channel: target })}
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
