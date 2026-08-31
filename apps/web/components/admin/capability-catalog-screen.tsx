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
import { listAgents } from "@/lib/agent-definition";
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
  /**
   * issue #1745 次要问题 2，第二轮收敛：目录条目与「真正可执行的 agent」是两张表
   * （见本文件头注），单靠 ID 前缀分辨不了。这里用 `listAgents` 的结果反查一遍——
   * 目录行的 id 命中 agents 表里的 `agentId` 就是「可执行」，否则是「仅目录」。
   * 只对 kind=agent 取，且只是**降噪**：取不到（比如非管理员被服务端拒绝）
   * 就不画徽章，不拿它当权限判断用。
   */
  const [executableIds, setExecutableIds] = React.useState<ReadonlySet<string> | null>(null);

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
      if (kind === "agent") {
        try {
          const agentRows = await listAgents();
          if (request !== generation.current || currentSourceKey.current !== sourceKey) return false;
          setExecutableIds(new Set(agentRows.map((r) => r.agentId)));
        } catch {
          // 降噪信息，取不到就不画徽章——不影响目录本身的读取结果。
          if (request === generation.current && currentSourceKey.current === sourceKey) {
            setExecutableIds(null);
          }
        }
      } else {
        setExecutableIds(null);
      }
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
        executable={kind === "agent" && executableIds ? executableIds.has(row.id) : null}
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
          {kind === "agent"
            ? "这里是能被选择的目录记录，与上方「Agent 列表」是两张表：出现在这里不代表已经具备可执行的 AgentRun——每行右侧的「可执行 / 仅目录」说明它是不是真的能对话。"
            : "这里只展示可选择的目录记录；出现在目录中不代表已经具备可执行的 Skill 运行时。"}
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

        2026-08-31 第二轮收敛（UIUX 复核见 design-signoff 素材）：第一版补丁是在表单
        上方贴一段小字警告——容易被跳过，且没有改变两个按钮同等视觉权重这件事本身。
        这次不合并两张表（后端短期不会合并，见复核文档「待人类确认」），只收敛**入口**
        与**视觉权重**：
          1) 触发按钮文案直接说清楚后果（`仅登记目录项（不可执行）`），不再叫
             `新增 Agent`——不用读警告文字就知道这不是"新建可对话的 agent"；
          2) 按钮从 `outline` 降到 `ghost`，视觉上让位给上方真正的"新建 / 导入 Agent"；
          3) 说明文字保留但收进展开态描述（`openDescription`），折叠态不常驻占版面；
          4) 目录行改用「可执行 / 仅目录」徽章（见 `executableIds` 与 `CapabilityRow`），
             不再要求用户去读 ID 前缀猜可执行性。
        本次仍然只做"界面消歧"，不下线这个入口、不改后端校验——那属于 #1745 主线收敛。
      */}
      {canMutate ? (
        <CapabilityCreatePanel
          key={`${sourceKey}:create`}
          ctx={ctx}
          triggerLabel={kind === "agent" ? "仅登记目录项（不可执行）" : undefined}
          triggerVariant={kind === "agent" ? "ghost" : "outline"}
          openTitle={kind === "agent" ? "仅登记目录项（不可执行）" : undefined}
          openDescription={
            kind === "agent"
              ? "写入的只是目录条目本身，不会创建可执行的 agent——它不会自动获得 " +
                "`agents`/`agent_versions` 记录，选中它发消息会失败。这是给运维场景用的" +
                "（例如给一个已经在别处发布好的 agent 改展示名）；要新建一个真正能对话的" +
                "agent，请用上方「新建 / 导入 Agent」。"
              : undefined
          }
        />
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
  row, prefix, editHref, canMutate, executable, onDisable,
}: {
  row: CapabilityListing;
  prefix: string;
  /** 已经带了 `?from=<这个屏当前的 URL>`——见 `CapabilityCatalogScreen` 里的 `editHrefFor`。 */
  editHref: string;
  canMutate: boolean;
  /**
   * `kind === "agent"` 时：这行是否命中了一个真正可执行的 agent（见 `executableIds`
   * 头注）。`null` = 不适用（kind=skill）或没能拿到答案，此时不画徽章、不下判断。
   */
  executable: boolean | null;
  onDisable(): void;
}) {
  return (
    <Card data-testid={`${prefix}-row-${row.id}`}>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-13 font-medium">{row.name}</span>
          <span className="font-mono text-10 text-muted-foreground">{row.id}</span>
        </div>
        {executable !== null ? (
          <Badge tone={executable ? "primary" : "warning"} data-testid={`${prefix}-row-${row.id}-executable`}>
            {executable ? "可执行" : "仅目录 · 不可执行"}
          </Badge>
        ) : null}
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
