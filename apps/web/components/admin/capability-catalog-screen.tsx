"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowUpRight, Ban, Globe, Pencil, Rocket } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import {
  listCapabilities,
  type CapabilityKind,
  type CapabilityListing,
  type MutateCapabilityResult,
} from "@/lib/live-capabilities";
import {
  listAgents,
  selfPublishAgent,
  setAgentRoleLabel,
  type AgentListRow,
} from "@/lib/agent-definition";
import {
  CapabilityCreatePanel,
  CapabilityDisableDialog,
  CapabilityEditForm,
  describeMutateError,
  type MutateContext,
} from "./capability-mutate";
import { SkillStarterImportPanel } from "./skill-starter-import-panel";
import { SkillUrlImportPanel } from "./skill-url-import-panel";
import { EntityCatalog, CardActions, tagOf, type CatalogTag } from "./entity-catalog";
import { KV } from "./panel";

type CatalogKind = Extract<CapabilityKind, "agent" | "skill">;
type LoadState =
  | { readonly sourceKey: string; readonly status: "loading" }
  | { readonly sourceKey: string; readonly status: "error"; readonly message: string }
  | { readonly sourceKey: string; readonly status: "ready"; readonly rows: readonly CapabilityListing[] };

/**
 * F55「可执行 agent 定义」（`GET /agents`，#1915）与 F15「目录条目」（`GET /capabilities`）
 * 是两张表、两条契约操作（见 `agent-definition-list-panel.tsx` 旧头注）。2026-09-02
 * 简化后它们**在同一个卡片网格里**各是一种卡片，靠标签「目录条目 / 可执行」区分——
 * 不再各摆一个列表。这个读取只在 `kind === "agent"` 时发起。
 */
type DefinitionState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly rows: readonly AgentListRow[] };

type CatalogItem =
  | { readonly kind: "listing"; readonly key: string; readonly listing: CapabilityListing }
  | { readonly kind: "definition"; readonly key: string; readonly def: AgentListRow };

const COPY: Record<CatalogKind, { label: string; title: string; singular: string }> = {
  agent: { label: "Agent", title: "Agent 目录", singular: "Agent" },
  skill: { label: "Skill", title: "Skill 目录", singular: "Skill" },
};

const SCOPE_LABEL = { "org-wide": "全组织可见", "team-only": "仅团队可见" } as const;

/**
 * 正式 Agent / Skill 面：它只画 `CapabilityListing` 有出处的字段。
 * 没有版本、挂载、调用量或运行状态，也没有 AgentRun 入口。
 *
 * #458 起，管理员多了新增 / 更新 / 停用三个入口，全部打到 `POST /capabilities/mutate`。
 * ⚠ 入口按缓存的 `orgRole` 挂载，那只是**降噪**；真正的拒绝在服务端，
 *   见 `capability-mutate.tsx` 头部与 `apps/api/tests/kernel/capability-mutate-authorization.test.ts`。
 *
 * 2026-09-02（人类原话：「简化…为一个卡片的列表，通过一个侧边面板来展示当前的实体的
 * 内容，可以增加删除修改，并通过 tag 来过滤和搜索」）：布局收敛到 `EntityCatalog`
 * （参照画布模板库）——分页、卡片/列表切换、常驻展开的新增表单都撤了：
 *   · 搜索 + 标签筛选替代分页（纯前端本地过滤）；
 *   · 点卡片打开右侧面板：看字段、就地改名称/可见范围、停用；「编辑」链接仍指向
 *     独立编辑页（人类 2026-08-17 裁决，skill 的文件树/代码编辑器只在那里）；
 *   · 新增表单收进弹窗（`CapabilityCreatePanel`），触发按钮挂在头部。
 * 契约层一字未动：读仍是 `listCapabilities`，写仍只有 `mutateCapability` 一条出口。
 */
export function CapabilityCatalogScreen({
  kind,
  headerActions,
  definitionsRefreshKey = 0,
}: {
  kind: CatalogKind;
  /** 头部额外动作（`agent-screen.tsx` 挂「新建 / 导入 Agent」）。 */
  headerActions?: React.ReactNode;
  /** 变化即重新拉取 F55 定义列表（新建 / 发布成功后由外层递增）。只对 `kind="agent"` 有意义。 */
  definitionsRefreshKey?: number;
}) {
  const { session, identity } = useSession();
  if (!session) throw new Error("CapabilityCatalogScreen requires an authenticated session");
  const orgId = session.currentOrgId;
  /**
   * 人类实测反馈（2026-08-30）：编辑页的「返回」此前写死回 `CapabilityEditPage` 自己
   * 猜的默认目的地，与「真的是从这个屏点进去的」是两回事——见 `capability-edit-page
   * .tsx` 里 `CATALOG_HREF` 头注的完整说法。这里把**当前这个屏自己的 URL**（含
   * `?screen=catalog` 这类查询参数）编码进 `?from=`，「编辑」链接带着它一起跳转。
   */
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const currentUrl = query === "" ? pathname : `${pathname}?${query}`;
  const editHrefFor = (id: string): string =>
    `/platform-admin/${kind}/${id}?from=${encodeURIComponent(currentUrl)}`;
  const copy = COPY[kind];
  const sourceKey = `${orgId}:${kind}`;
  const prefix = `admin-${kind}`;
  const generation = React.useRef(0);
  const currentSourceKey = React.useRef(sourceKey);
  currentSourceKey.current = sourceKey;
  const [state, setState] = React.useState<LoadState>({ sourceKey, status: "loading" });
  const [definitions, setDefinitions] = React.useState<DefinitionState>({ status: "idle" });
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [disablingId, setDisablingId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [mutateError, setMutateError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    // A completion from a panel belonging to the previous organization must not become
    // the newest generation and suppress the current organization's real request.
    if (currentSourceKey.current !== sourceKey) return false;
    const request = ++generation.current;
    setState({ sourceKey, status: "loading" });
    try {
      const rows = await listCapabilities(orgId, kind);
      if (request !== generation.current || currentSourceKey.current !== sourceKey) return false;
      setState({ sourceKey, status: "ready", rows });
      return true;
    } catch (error) {
      if (request !== generation.current || currentSourceKey.current !== sourceKey) return false;
      setState({ sourceKey, status: "error", message: describeError(error) });
      return false;
    }
  }, [kind, orgId, sourceKey]);

  const definitionGeneration = React.useRef(0);
  const loadDefinitions = React.useCallback(async () => {
    if (kind !== "agent") return;
    const request = ++definitionGeneration.current;
    setDefinitions({ status: "loading" });
    try {
      const rows = await listAgents();
      if (request !== definitionGeneration.current) return;
      setDefinitions({ status: "ready", rows });
    } catch (error) {
      if (request !== definitionGeneration.current) return;
      setDefinitions({ status: "error", message: describeError(error) });
    }
  }, [kind]);

  React.useEffect(() => {
    // 换组织 = 上一组织的写入口状态全部作废，包括那条「N 个调用被中断」的提示：
    // 它说的是另一个组织发生过的事，留在屏幕上就是一句张冠李戴的事实。
    setDisablingId(null);
    setSelectedKey(null);
    setNotice(null);
    setMutateError(null);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  React.useEffect(() => {
    void loadDefinitions();
    return () => {
      definitionGeneration.current += 1;
    };
  }, [loadDefinitions, definitionsRefreshKey, orgId]);

  // 只有管理员挂载写入口——**降噪，不是权限**。裁决在服务端，见文件头。
  const canMutate = identity?.orgRole === "admin";

  const ctx: MutateContext = {
    orgId,
    kind,
    prefix,
    singular: copy.singular,
    async onMutated(result: MutateCapabilityResult) {
      setMutateError(null);
      setNotice(describeResult(result));
      return load();
    },
  };

  // Effects run after paint. A source mismatch must therefore fail closed during render itself;
  // otherwise a newly selected organization can briefly inherit the previous organization's rows.
  const visibleState: LoadState = React.useMemo(
    () => (state.sourceKey === sourceKey ? state : { sourceKey, status: "loading" }),
    [state, sourceKey],
  );
  const listings = React.useMemo(
    () => (visibleState.status === "ready" ? visibleState.rows : []),
    [visibleState],
  );
  const definitionRows = React.useMemo(
    () => (definitions.status === "ready" ? definitions.rows : []),
    [definitions],
  );
  const items = React.useMemo<readonly CatalogItem[]>(
    () => [
      ...listings.map((listing): CatalogItem => ({ kind: "listing", key: listing.id, listing })),
      ...definitionRows.map((def): CatalogItem => ({ kind: "definition", key: `def:${def.agentId}`, def })),
    ],
    [listings, definitionRows],
  );
  // 从**当前这批 rows** 里找，而不是把点击时的那一份存进 state：
  // 后者会在刷新之后继续指着一条服务端已经改掉的记录。
  const disablingRow = listings.find((r) => r.id === disablingId) ?? null;

  const tagsOf = React.useCallback((item: CatalogItem): readonly CatalogTag[] => {
    if (item.kind === "listing") {
      const r = item.listing;
      return [
        ...(kind === "agent" ? [{ key: "listing", label: "目录条目" }] : []),
        tagOf(r.scope, SCOPE_LABEL[r.scope]),
        r.enabled ? tagOf("已启用") : tagOf("已停用"),
      ];
    }
    const d = item.def;
    return [
      { key: "executable", label: "可执行" },
      tagOf(d.visibility),
      tagOf(d.publishState),
    ];
  }, [kind]);

  const searchTextOf = React.useCallback((item: CatalogItem): string => {
    if (item.kind === "listing") {
      const r = item.listing;
      return [r.name, r.id, r.endpoint ?? "", r.disabledReason ?? ""].join(" ");
    }
    const d = item.def;
    return [d.name, d.agentId, d.initials, d.role, d.roleLabel].join(" ");
  }, []);

  function openDisable(row: CapabilityListing) {
    setNotice(null);
    setMutateError(null);
    setSelectedKey(row.id);
    setDisablingId(row.id);
  }

  return (
    <EntityCatalog<CatalogItem>
      prefix={prefix}
      rootTestId={`${prefix}-catalog`}
      title={copy.title}
      description="这里只展示可选择的目录记录；出现在目录中不代表已经具备可执行的 AgentRun 或 Skill 运行时。点卡片打开右侧面板查看与修改。"
      eyebrow={
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
          {/* 2026-09-02 第二次裁决：AI 能力归平台后台——页头与 `admin-header.tsx` 的
              `hideOrgIdentity` 分支同形：平台标记 + 模块徽标，不再挂「组织：xxx / 组织 ID」
              身份卡（数据读取仍按当前组织走 RLS，只是呈现上这不是一项组织级配置）。 */}
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inverse text-inverse-foreground">
            <Globe aria-hidden className="h-4 w-4" />
          </span>
          <span className="text-14 font-semibold" data-testid={`${prefix}-platform-label`}>平台运营</span>
          <Badge tone="outline">{copy.label}</Badge>
        </div>
      }
      headerActions={
        canMutate ? (
          <>
            {headerActions}
            {/*
             * ⚠ 2026-09-03 补——`CapabilityCreatePanel` 对 `kind === "skill"` 是
             * #1745 描述的同一个陷阱，且比 agent 那边更彻底：`POST /capabilities/mutate`
             * 的 `op: "add"` 只 INSERT 一行 `capability_listings`（`mutate-capability.ts`
             * `op === "add"` 分支），从不写 `skills`/`skill_versions`——建出来的这一行
             * 在目录里看起来和真实导入的 skill 一模一样、能被挂载（`enabled=true` 就够），
             * 但没有任何源码文件：打开「编辑源码」会撞上 `getAssetDirectory` 404
             * （见 `ag-screens.tsx` 的 `liveError` 分支），挂进 chat 执行会
             * `SKILL_VERSION_UNAVAILABLE`。
             *
             * agent 那边保留入口 + 弹窗内加提示（`capability-mutate.tsx` 的
             * `create-agent-caveat`），是因为它承认了一种合法用途——运维手动登记一个
             * 已经在别处发布好、只是想改展示名的 agent。skill 没有这种对应场景：
             * 模型 B 的声明式创建路径已经冻结（`POST /skills` 恒
             * `410 SKILL_DRAFT_WRITE_PATH_FROZEN`），一个 skill 要有真实可执行的内容，
             * 今天只有下面 `notices` 里已经挂着的两条路径——
             * `SkillStarterImportPanel`/`SkillUrlImportPanel`，二者都已经在写
             * `capability_listings` 的同一事务里把 `skills`/`skill_versions` 也建出来。
             * 按本仓「宁可显式禁用并说明，不放一个点了没反应/报假错的按钮」的纪律，
             * 对 skill 直接不挂载这个入口。
             */}
            {kind !== "skill" ? <CapabilityCreatePanel key={`${sourceKey}:create`} ctx={ctx} /> : null}
          </>
        ) : headerActions
      }
      notices={
        <>
          {kind === "skill" && canMutate ? (
            <p
              className="text-12 text-muted-foreground"
              data-testid={`${prefix}-create-skill-hidden-note`}
            >
              Skill 没有单独的「新增目录条目」入口——新建 skill 请用下方「从 GitHub /
              URL 导入」或「从 starter pack 导入」，两者才会真正写入可执行的源码文件。
            </p>
          ) : null}
          {kind === "skill" && canMutate ? <SkillStarterImportPanel key={sourceKey} onImported={load} /> : null}
          {/*
            ⚠ key 与上面那块必须不同——两个兄弟节点用同一个 key 时 React 会把它们
            当成同一个位置的同一个东西，换组织时上面那块就不再重挂载，上一组织填了
            一半的输入会留在新组织的界面上（`skill-starter-import.test.tsx` 当场红过）。
          */}
          {kind === "skill" && canMutate ? <SkillUrlImportPanel key={`${sourceKey}:url-import`} onImported={load} /> : null}
          {definitions.status === "error" ? (
            <p data-testid={`${prefix}-definition-list-error`} className="text-12 text-destructive">
              可执行 Agent 定义读取失败：{definitions.message}（目录条目不受影响）
            </p>
          ) : null}
          {notice ? (
            <p data-testid={`${prefix}-mutate-notice`} className="text-12 text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {mutateError ? (
            <p data-testid={`${prefix}-mutate-error`} className="text-12 text-destructive">
              操作失败：{mutateError}
            </p>
          ) : null}
        </>
      }
      status={
        visibleState.status === "ready"
          ? { kind: "ready" }
          : visibleState.status === "error"
            ? { kind: "error", message: visibleState.message }
            : { kind: "loading" }
      }
      rows={items}
      keyOf={(item) => item.key}
      searchTextOf={searchTextOf}
      tagsOf={tagsOf}
      cardTestId={(item) => (item.kind === "listing" ? `${prefix}-row-${item.listing.id}` : `${prefix}-definition-${item.def.agentId}`)}
      renderCard={(item) =>
        item.kind === "listing" ? (
          <ListingCard
            row={item.listing}
            prefix={prefix}
            editHref={editHrefFor(item.listing.id)}
            canMutate={canMutate}
            onDisable={() => openDisable(item.listing)}
          />
        ) : (
          <DefinitionCard row={item.def} prefix={prefix} />
        )
      }
      onRefresh={() => {
        void load();
        void loadDefinitions();
      }}
      emptyState={`当前组织还没有 ${copy.label} 目录项。`}
      searchPlaceholder={`按名字、ID 或职责搜索 ${copy.label}…`}
      selectedKey={selectedKey}
      onSelect={(key) => {
        setSelectedKey(key);
        if (key === null) setDisablingId(null);
      }}
      detailTitle={(item) => (item.kind === "listing" ? item.listing.name : item.def.name)}
      detailSubtitle={(item) => (item.kind === "listing" ? `目录条目 · ${item.listing.id}` : `可执行 Agent 定义 · ${item.def.agentId}`)}
      renderDetail={(item) =>
        item.kind === "listing" ? (
          <ListingDetail
            row={item.listing}
            ctx={ctx}
            canMutate={canMutate}
            editHref={editHrefFor(item.listing.id)}
            disabling={disablingRow?.id === item.listing.id ? disablingRow : null}
            onRequestDisable={() => openDisable(item.listing)}
            onCancelDisable={() => setDisablingId(null)}
            onDisableFailed={(message) => {
              setNotice(null);
              setMutateError(message);
            }}
            onClose={() => setSelectedKey(null)}
          />
        ) : (
          <DefinitionDetail
            row={item.def}
            prefix={prefix}
            canMutate={canMutate}
            onChanged={(message) => {
              setMutateError(null);
              setNotice(message);
              void loadDefinitions();
            }}
          />
        )
      }
    />
  );
}

/* ───────────────────────── 卡片 ───────────────────────── */

function ListingCard({
  row, prefix, editHref, canMutate, onDisable,
}: {
  row: CapabilityListing;
  prefix: string;
  /** 已经带了 `?from=<这个屏当前的 URL>`——见 `CapabilityCatalogScreen` 里的 `editHrefFor`。 */
  editHref: string;
  canMutate: boolean;
  onDisable(): void;
}) {
  return (
    <CardContent className="flex h-full flex-col gap-2 pt-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-13 font-medium">{row.name}</span>
        <span className="truncate font-mono text-10 text-muted-foreground">{row.id}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="outline">{SCOPE_LABEL[row.scope]}</Badge>
        <Badge tone={row.enabled ? "primary" : "outline"}>{row.enabled ? "已启用" : "已停用"}</Badge>
      </div>
      {!row.enabled && row.disabledReason ? (
        <span className="text-11 text-muted-foreground">{row.disabledReason}</span>
      ) : null}
      {row.endpoint ? <span className="truncate font-mono text-10 text-muted-foreground">{row.endpoint}</span> : null}
      {canMutate ? (
        <CardActions className="mt-auto pt-1">
          <Button asChild size="xs" variant="outline" data-testid={`${prefix}-row-${row.id}-edit`}>
            <Link href={editHref}>
              <Pencil aria-hidden className="h-3 w-3" />
              编辑
            </Link>
          </Button>
          {/* 已停用的记录没有「再停用一次」——那会写出一条什么都没改变的 provenance 记录。 */}
          {row.enabled ? (
            <Button size="xs" variant="outline" onClick={onDisable} data-testid={`${prefix}-row-${row.id}-disable`}>
              <Ban aria-hidden className="h-3 w-3" />
              停用
            </Button>
          ) : null}
        </CardActions>
      ) : null}
    </CardContent>
  );
}

function DefinitionCard({ row, prefix }: { row: AgentListRow; prefix: string }) {
  return (
    <CardContent className="flex h-full flex-col gap-2 pt-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-10 font-semibold text-muted-foreground">
          {row.initials}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-13 font-medium" data-testid={`${prefix}-definition-${row.agentId}-name`}>{row.name}</span>
          <span className="truncate text-11 text-muted-foreground">{row.roleLabel || row.role}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="ai">可执行</Badge>
        <Badge tone="outline">{row.visibility}</Badge>
        <Badge tone={row.publishState === "运行中" ? "primary" : "outline"} data-testid={`${prefix}-definition-${row.agentId}-state`}>
          {row.publishState}
        </Badge>
      </div>
      <span className="text-11 text-muted-foreground">{row.skillCount} 个 skill 挂载</span>
    </CardContent>
  );
}

/* ───────────────────────── 面板 ───────────────────────── */

function ListingDetail({
  row, ctx, canMutate, editHref, disabling, onRequestDisable, onCancelDisable, onDisableFailed, onClose,
}: {
  row: CapabilityListing;
  ctx: MutateContext;
  canMutate: boolean;
  editHref: string;
  disabling: CapabilityListing | null;
  onRequestDisable(): void;
  onCancelDisable(): void;
  onDisableFailed(message: string): void;
  onClose(): void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col divide-y divide-border-subtle">
        <KV k="名称" v={row.name} />
        <KV k="ID" v={<span className="font-mono text-11">{row.id}</span>} />
        <KV k="可见范围" v={SCOPE_LABEL[row.scope]} />
        <KV k="状态" v={row.enabled ? "已启用" : `已停用${row.disabledReason ? ` · ${row.disabledReason}` : ""}`} />
        {row.endpoint ? <KV k="端点" v={<span className="font-mono text-11">{row.endpoint}</span>} /> : null}
      </div>

      {canMutate && disabling ? (
        <CapabilityDisableDialog
          ctx={ctx}
          row={disabling}
          onClose={onCancelDisable}
          onFailed={onDisableFailed}
        />
      ) : null}

      {canMutate ? (
        <div className="flex flex-col gap-2">
          <span className="text-10 uppercase tracking-wide text-muted-foreground">修改名称 / 可见范围</span>
          <CapabilityEditForm ctx={ctx} row={row} onClose={onClose} />
        </div>
      ) : (
        <p className="text-11 text-muted-foreground">只有组织管理员可以修改 {ctx.singular} 目录项。</p>
      )}

      {canMutate ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
          <Button asChild size="xs" variant="outline" data-testid={`${ctx.prefix}-detail-open-editor`}>
            <Link href={editHref}>
              打开完整编辑页
              <ArrowUpRight aria-hidden className="h-3 w-3" />
            </Link>
          </Button>
          {row.enabled && !disabling ? (
            <Button size="xs" variant="outline" onClick={onRequestDisable} data-testid={`${ctx.prefix}-detail-disable`}>
              <Ban aria-hidden className="h-3 w-3" />
              停用（从目录移除）
            </Button>
          ) : null}
        </div>
      ) : null}
      {/*
        契约 `mutateCapability` 只有 add / update / disable 三个 op，没有硬删除：
        「停用」就是把它从可选目录里移走、并写一条 provenance——这里如实叫停用，
        不画一个其实只是停用的「删除」按钮。
      */}
      <p className="text-10 text-muted-foreground">
        目录没有永久删除——「停用」把它移出可选目录并写审计，是这条契约里唯一的移除方式。
      </p>
    </div>
  );
}

/**
 * F55 定义面板：字段来自 `listAgents` 的返回，一字不添。可改的只有后端本轮真接了
 * PATCH 的 `roleLabel`（`setAgentRoleLabel`）；「发布」走 `selfPublishAgent`。
 * 指令原文契约没暴露读路径，这里不摆一个会把它清空的编辑框。
 */
function DefinitionDetail({
  row, prefix, canMutate, onChanged,
}: {
  row: AgentListRow;
  prefix: string;
  canMutate: boolean;
  onChanged(message: string): void;
}) {
  const [roleLabel, setRoleLabel] = React.useState(row.roleLabel);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setRoleLabel(row.roleLabel), [row.agentId, row.roleLabel]);
  const id = `${prefix}-definition-${row.agentId}`;
  const dirty = roleLabel.trim() !== row.roleLabel;

  async function act(what: string, run: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await run());
    } catch (e) {
      setError(`${what}失败：${describeMutateError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col divide-y divide-border-subtle">
        <KV k="名称" v={row.name} />
        <KV k="Agent ID" v={<span className="font-mono text-11">{row.agentId}</span>} />
        <KV k="缩写" v={row.initials} />
        <KV k="角色" v={row.role} />
        <KV k="可见范围" v={row.visibility} />
        <KV k="发布状态" v={row.publishState} />
        <KV k="模型" v={row.modelId ?? "未指定"} />
        <KV k="挂载 skill" v={`${row.skillCount} 个`} />
      </div>
      {canMutate ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-12" htmlFor={`${id}-role-label`}>
            <span className="text-10 uppercase tracking-wide text-muted-foreground">角色头衔</span>
            <Input
              id={`${id}-role-label`}
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              disabled={busy}
              data-testid={`${id}-role-label`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              disabled={busy || !dirty || roleLabel.trim() === ""}
              onClick={() =>
                void act("保存", async () => {
                  await setAgentRoleLabel(row.agentId, roleLabel.trim());
                  return `已更新「${row.name}」的角色头衔`;
                })
              }
              data-testid={`${id}-save`}
            >
              保存头衔
            </Button>
            {row.publishState === "草稿" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act("发布", async () => {
                    const out = await selfPublishAgent(row.agentId);
                    return `已发布「${row.name}」：${out.publishState}`;
                  })
                }
                data-testid={`${id}-publish`}
              >
                <Rocket aria-hidden className="h-3 w-3" />
                自助发布
              </Button>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-11 text-destructive" data-testid={`${id}-error`}>{error}</p>
          ) : null}
          <p className="text-10 text-muted-foreground">
            契约里没有删除 agent 定义的操作；停用走「运行中 → 已停用」的状态机，本轮前端未接线。
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** 「N 个进行中的调用」是契约明确要求显示的答案，不是统计口径。 */
function describeResult(result: MutateCapabilityResult): string {
  return `已写入组织目录：${result.listing.name}（受影响的进行中调用 ${result.affectedInFlightCalls} 个，凭证 ${result.provenanceEventId}）`;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.reasonCode ?? `HTTP ${error.status}`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}
