"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Ban, Building2, Pencil, RefreshCw } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination, PaginationNext, PaginationPrevious, PaginationStatus } from "@/components/ui/pagination";
import { ApiError } from "@/lib/api-client";
import { currentOrganizationLabel } from "@/lib/org-display";
import {
  listCapabilities,
  type CapabilityKind,
  type CapabilityListing,
  type MutateCapabilityResult,
} from "@/lib/live-capabilities";
import {
  CapabilityCreatePanel,
  CapabilityDisableDialog,
  type MutateContext,
} from "./capability-mutate";
import { SkillStarterImportPanel } from "./skill-starter-import-panel";
import { SkillUrlImportPanel } from "./skill-url-import-panel";
import { EntityViewToggle } from "./entity-view-toggle";

const PAGE_SIZE = 10;

type CatalogKind = Extract<CapabilityKind, "agent" | "skill">;
type LoadState =
  | { readonly sourceKey: string; readonly status: "loading" }
  | { readonly sourceKey: string; readonly status: "error"; readonly message: string }
  | { readonly sourceKey: string; readonly status: "ready"; readonly rows: readonly CapabilityListing[] };

const COPY: Record<CatalogKind, { label: string; title: string; singular: string }> = {
  agent: { label: "Agent", title: "Agent 目录", singular: "Agent" },
  skill: { label: "Skill", title: "Skill 目录", singular: "Skill" },
};

/**
 * 正式 Agent / Skill 面：它只画 `CapabilityListing` 有出处的字段。
 * 没有版本、挂载、调用量或运行状态，也没有 AgentRun 入口。
 *
 * #458 起，管理员多了新增 / 更新 / 停用三个入口，全部打到 `POST /capabilities/mutate`。
 * ⚠ 入口按缓存的 `orgRole` 挂载，那只是**降噪**；真正的拒绝在服务端，
 *   见 `capability-mutate.tsx` 头部与 `apps/api/tests/kernel/capability-mutate-authorization.test.ts`。
 */
export function CapabilityCatalogScreen({
  kind,
}: {
  kind: CatalogKind;
}) {
  const { session, identity } = useSession();
  if (!session) throw new Error("CapabilityCatalogScreen requires an authenticated session");
  const orgId = session.currentOrgId;
  /**
   * 人类实测反馈（2026-08-30）：编辑页的「返回」此前写死回 `CapabilityEditPage` 自己
   * 猜的默认目的地，与「真的是从这个屏点进去的」是两回事——见 `capability-edit-page
   * .tsx` 里 `CATALOG_HREF` 头注的完整说法。这里把**当前这个屏自己的 URL**（含
   * `?screen=catalog` 这类查询参数——同一个组件在 `/admin/agent` 与 `/skill?screen=
   * catalog` 两个不同 URL 下渲染）编码进 `?from=`，「编辑」链接带着它一起跳转。
   */
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const currentUrl = query === "" ? pathname : `${pathname}?${query}`;
  const editHrefFor = (id: string): string =>
    `/admin/${kind}/${id}?from=${encodeURIComponent(currentUrl)}`;
  const copy = COPY[kind];
  const sourceKey = `${orgId}:${kind}`;
  const prefix = `admin-${kind}`;
  const generation = React.useRef(0);
  const currentSourceKey = React.useRef(sourceKey);
  currentSourceKey.current = sourceKey;
  const [page, setPage] = React.useState(0);
  const [state, setState] = React.useState<LoadState>({ sourceKey, status: "loading" });
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
      setPage(0);
      setState({ sourceKey, status: "ready", rows });
      return true;
    } catch (error) {
      if (request !== generation.current || currentSourceKey.current !== sourceKey) return false;
      setState({ sourceKey, status: "error", message: describeError(error) });
      return false;
    }
  }, [kind, orgId, sourceKey]);

  React.useEffect(() => {
    // 换组织 = 上一组织的写入口状态全部作废，包括那条「N 个调用被中断」的提示：
    // 它说的是另一个组织发生过的事，留在屏幕上就是一句张冠李戴的事实。
    setDisablingId(null);
    setNotice(null);
    setMutateError(null);
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

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
  const visibleState: LoadState = state.sourceKey === sourceKey
    ? state
    : { sourceKey, status: "loading" };
  const rows = visibleState.status === "ready" ? visibleState.rows : [];
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visibleRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // 从**当前这批 rows** 里找，而不是把点击时的那一份存进 state：
  // 后者会在刷新之后继续指着一条服务端已经改掉的记录。
  const disablingRow = rows.find((r) => r.id === disablingId) ?? null;

  /**
   * 卡片 / 列表两态**渲染同一个 `CapabilityRow`**——它本来就已经是一张 `<Card>`，
   * 差别只在外层是网格排列（卡片态）还是单列纵向排列（列表态，即改动前的原始布局）。
   * 这样切换视图不改变任何一行内部的结构与 testid，编辑 / 停用逻辑原样复用。
   */
  /**
   * 人类反馈（2026-08-17）：点击「编辑」应该打开一个新的界面，而不是在当前列表页里
   * 内联展开——`CapabilityRow` 因此不再自己维护 `editing` 状态，「编辑」按钮直接是
   * 一条指向 `/admin/[kind]/[id]` 的链接（`CapabilityEditPage`，见该文件头注）。
   */
  function renderCapabilityRow(row: CapabilityListing) {
    return (
      <CapabilityRow
        row={row}
        prefix={prefix}
        editHref={editHrefFor(row.id)}
        canMutate={canMutate}
        onDisable={() => {
          setNotice(null);
          setMutateError(null);
          setDisablingId(row.id);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 p-6" data-testid={`${prefix}-catalog`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inverse text-inverse-foreground">
            <Building2 aria-hidden className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            {/* #596：身份未就绪时显示加载态，**不拿 orgId 冒充组织名** —— 下一行本来就单独列了组织 ID。 */}
            <span className="text-14 font-semibold">{currentOrganizationLabel(identity?.org.name)}</span>
            <span className="font-mono text-10 text-muted-foreground">组织 ID {orgId}</span>
          </div>
          <Badge tone="outline">{copy.label}</Badge>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load()}
          disabled={visibleState.status === "loading"}
          data-testid={`${prefix}-refresh`}
        >
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          {visibleState.status === "loading" ? "加载中…" : "刷新"}
        </Button>
      </header>

      <div className="flex flex-col gap-1">
        <h1 className="text-20 font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-13 text-muted-foreground">
          这里只展示可选择的目录记录；出现在目录中不代表已经具备可执行的 AgentRun 或 Skill 运行时。
        </p>
      </div>

      {kind === "skill" && canMutate ? (
        <SkillStarterImportPanel key={sourceKey} onImported={load} />
      ) : null}

      {/*
        #881 F2：从 URL 导入。后端 `POST /admin/skills/url-imports`（#595）早就接好，
        此前 `apps/web` 零调用，用户在后台只能导 starter pack。
        ⚠ key 与上面那块必须不同（注意：不是可选项）——理由见下面那段注释：
          同一 key 会让换组织时不重挂载，上一组织填了一半的输入会留在新组织的界面上。
      */}
      {kind === "skill" && canMutate ? (
        <SkillUrlImportPanel key={`${sourceKey}:url-import`} onImported={load} />
      ) : null}

      {/*
        ⚠ key 必须与上面那块的 key「不同」。两个兄弟节点用同一个 key 时 React 会把它们
        当成同一个位置的同一个东西，换组织时上面那块就不再重挂载——上一组织填了一半的
        starter pack 坐标会原样留在新组织的界面上。这不是推演：`skill-starter-import.test.tsx`
        的换组织那条在本次改动里当场红了，就是因为第一版两处都写了 `key={sourceKey}`。
      */}
      {/*
        issue #1745 次要问题 2——`/admin/agent` 页面同时挂着两个都叫"新建/新增 Agent"
        的入口：上面 `AgentScreen` 的"新建 / 导入 Agent"（写 `agents`/`agent_versions`，
        走 `createAgent` → 双人评审/自助发布才能真正可执行）与下面这个
        `CapabilityCreatePanel`（直接 INSERT `capability_listings`，没有任何
        `agents`/`agent_versions` 行背书）。两者界面上此前没有任何区分，用户随机点中
        后者建出来的"agent"能进 chat 编制选择器（`enabled=true` 就够），但一发消息就是
        422 `AGENT_NOT_FOUND`——这正是 #1745 描述的"两条路径都能跑，但拼不出一个真正
        可用的 agent"里的一半。
        本次只做"界面消歧"（#1745 给出的两个选项之一），不下线这个入口——它是否还有
        legitimate 用途（如运维手动登记一个已经在别处发布好、只是想改个展示名的
        agent）、要不要连带收紧后端 `mutateCapability` 校验，属于 #1745 主线收敛要
        处理的更大范围，本次不顺手扩大改动面。
      */}
      {canMutate && kind === "agent" ? (
        <p
          className="text-12 text-muted-foreground"
          data-testid={`${prefix}-create-agent-caveat`}
        >
          ⚠ 这里新增的是目录条目本身，不会创建可执行的 agent——它不会自动获得
          `agents`/`agent_versions` 记录，选中它发消息会失败。要新建一个真正能对话的
          agent，请用上方「新建 / 导入 Agent」。
        </p>
      ) : null}
      {/*
       * ⚠ 2026-09-03 补——`CapabilityCreatePanel` 对 `kind === "skill"` 就是 #1745
       * 描述的同一个陷阱，且比 agent 那边更彻底：`POST /capabilities/mutate` 的
       * `op: "add"` 只 INSERT 一行 `capability_listings`（`mutate-capability.ts`
       * `op === "add"` 分支），从不写 `skills`/`skill_versions`——建出来的这一行
       * 在目录里看起来和真实导入的 skill 一模一样、能被挂载（`enabled=true` 就够），
       * 但没有任何源码文件：打开「编辑源码」会撞上 `getAssetDirectory` 404
       * （见 `ag-screens.tsx` 的 `liveError` 分支），挂进 chat 执行会
       * `SKILL_VERSION_UNAVAILABLE`。
       *
       * agent 那边选择"留着入口 + 加提示"，是因为它承认了一种合法用途——运维手动
       * 登记一个已经在别处发布好、只是想改展示名的 agent（见上面那段注释）。skill
       * 没有这种对应场景：模型 B 的声明式创建路径已经冻结（`POST /skills` 恒
       * `410 SKILL_DRAFT_WRITE_PATH_FROZEN`，`skill.controller.ts`），一个 skill
       * 要有真实可执行的内容，今天只有这个页面上方已经挂着的两条路径——
       * `SkillStarterImportPanel`/`SkillUrlImportPanel`。二者都已经在写
       * `capability_listings` 的同一事务里把 `skills`/`skill_versions` 也建出来，
       * 没有留下"先建目录条目、内容以后再补"这种中间态需要这个入口来补。按本仓
       * 「宁可显式禁用并说明，不放一个点了没反应/报假错的按钮」的纪律，
       * 对 skill 直接不挂载这个入口，而不是也加一句大概率被忽略的提示文字。
       */}
      {canMutate && kind === "skill" ? (
        <p
          className="text-12 text-muted-foreground"
          data-testid={`${prefix}-create-skill-hidden-note`}
        >
          Skill 没有单独的「新增目录条目」入口——新建 skill 请用上方「从 GitHub /
          URL 导入」或「从 starter pack 导入」，两者才会真正写入可执行的源码文件。
        </p>
      ) : null}
      {canMutate && kind !== "skill" ? <CapabilityCreatePanel key={`${sourceKey}:create`} ctx={ctx} /> : null}

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

      {canMutate && disablingRow ? (
        <CapabilityDisableDialog
          ctx={ctx}
          row={disablingRow}
          onClose={() => setDisablingId(null)}
          onFailed={(message) => {
            setNotice(null);
            setMutateError(message);
          }}
        />
      ) : null}

      {visibleState.status === "loading" ? (
        <div
          data-testid={`${prefix}-loading`}
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          正在读取当前组织的 {copy.label} 目录…
        </div>
      ) : null}

      {visibleState.status === "error" ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p data-testid={`${prefix}-error`} className="text-12 text-destructive">
            {copy.label} 目录读取失败：{visibleState.message}
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()} data-testid={`${prefix}-retry`}>
            重试
          </Button>
        </div>
      ) : null}

      {visibleState.status === "ready" && rows.length === 0 ? (
        <div
          data-testid={`${prefix}-empty`}
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          当前组织还没有 {copy.label} 目录项。
        </div>
      ) : null}

      {visibleState.status === "ready" && rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-12 text-muted-foreground">
            <span>共 {rows.length} 条组织目录记录</span>
            <PaginationStatus data-testid={`${prefix}-page-status`}>第 {page + 1} / {pageCount} 页</PaginationStatus>
          </div>
          {/*
            人类原话（2026-08-15）：「后台的管理功能…左边还是保留一个 column 显示当前的
            后台菜单，右边列出卡片来表达当前的 entity 的列表，卡片也可以切换为列表」。
            ⚠ 两个 testid 都指回改动前就存在的 `${prefix}-list`——不管当前选的是卡片还是
              列表视图，容器 testid 都不变，`capability-catalog-*.test.tsx` 等既有测试
              不需要跟着这次改动重写。
          */}
          <EntityViewToggle
            prefix={prefix}
            entities={visibleRows}
            keyOf={(row) => row.id}
            renderCard={renderCapabilityRow}
            renderListRow={renderCapabilityRow}
            cardContainerTestId={`${prefix}-list`}
            listContainerTestId={`${prefix}-list`}
          />
          {pageCount > 1 ? (
            <Pagination aria-label={`${copy.label}分页`} className="justify-end">
              <PaginationPrevious
                disabled={page === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                data-testid={`${prefix}-previous-page`}
              />
              <PaginationNext
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                data-testid={`${prefix}-next-page`}
              />
            </Pagination>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CapabilityRow({
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
    <Card data-testid={`${prefix}-row-${row.id}`}>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-13 font-medium">{row.name}</span>
          <span className="font-mono text-10 text-muted-foreground">{row.id}</span>
        </div>
        <Badge tone="outline">{row.scope === "org-wide" ? "全组织可见" : "仅团队可见"}</Badge>
        <Badge tone={row.enabled ? "primary" : "outline"}>{row.enabled ? "已启用" : "已停用"}</Badge>
        {!row.enabled && row.disabledReason ? (
          <span className="w-full text-11 text-muted-foreground sm:w-auto">{row.disabledReason}</span>
        ) : null}
        {row.endpoint ? <span className="w-full truncate font-mono text-10 text-muted-foreground">{row.endpoint}</span> : null}
        {canMutate ? (
          <div className="flex shrink-0 gap-2">
            <Button asChild size="sm" variant="outline" data-testid={`${prefix}-row-${row.id}-edit`}>
              <Link href={editHref}>
                <Pencil aria-hidden className="h-3.5 w-3.5" />
                编辑
              </Link>
            </Button>
            {/* 已停用的记录没有「再停用一次」——那会写出一条什么都没改变的 provenance 记录。 */}
            {row.enabled ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onDisable}
                data-testid={`${prefix}-row-${row.id}-disable`}
              >
                <Ban aria-hidden className="h-3.5 w-3.5" />
                停用
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
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
