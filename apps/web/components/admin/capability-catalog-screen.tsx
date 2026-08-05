"use client";

import * as React from "react";
import { Ban, Building2, Pencil, RefreshCw } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import {
  listCapabilities,
  type CapabilityKind,
  type CapabilityListing,
  type MutateCapabilityResult,
} from "@/lib/live-capabilities";
import {
  CapabilityCreatePanel,
  CapabilityDisableDialog,
  CapabilityEditForm,
  type MutateContext,
} from "./capability-mutate";
import { SkillStarterImportPanel } from "./skill-starter-import-panel";

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
export function CapabilityCatalogScreen({ kind }: { kind: CatalogKind }) {
  const { session, identity } = useSession();
  if (!session) throw new Error("CapabilityCatalogScreen requires an authenticated session");
  const orgId = session.currentOrgId;
  const copy = COPY[kind];
  const sourceKey = `${orgId}:${kind}`;
  const prefix = `admin-${kind}`;
  const generation = React.useRef(0);
  const currentSourceKey = React.useRef(sourceKey);
  currentSourceKey.current = sourceKey;
  const [page, setPage] = React.useState(0);
  const [state, setState] = React.useState<LoadState>({ sourceKey, status: "loading" });
  const [editingId, setEditingId] = React.useState<string | null>(null);
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
    setEditingId(null);
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

  return (
    <div className="flex flex-col gap-5 p-6" data-testid={`${prefix}-catalog`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-inverse text-inverse-foreground">
            <Building2 aria-hidden className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-14 font-semibold">{identity?.org.name ?? orgId}</span>
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
        ⚠ key 必须与上面那块的 key「不同」。两个兄弟节点用同一个 key 时 React 会把它们
        当成同一个位置的同一个东西，换组织时上面那块就不再重挂载——上一组织填了一半的
        starter pack 坐标会原样留在新组织的界面上。这不是推演：`skill-starter-import.test.tsx`
        的换组织那条在本次改动里当场红了，就是因为第一版两处都写了 `key={sourceKey}`。
      */}
      {canMutate ? <CapabilityCreatePanel key={`${sourceKey}:create`} ctx={ctx} /> : null}

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
            <span data-testid={`${prefix}-page-status`}>第 {page + 1} / {pageCount} 页</span>
          </div>
          <div className="flex flex-col gap-2" data-testid={`${prefix}-list`}>
            {visibleRows.map((row) => (
              <CapabilityRow
                key={row.id}
                row={row}
                prefix={prefix}
                ctx={ctx}
                canMutate={canMutate}
                editing={editingId === row.id}
                onEdit={() => setEditingId(row.id)}
                onCloseEdit={() => setEditingId(null)}
                onDisable={() => {
                  setNotice(null);
                  setMutateError(null);
                  setDisablingId(row.id);
                }}
              />
            ))}
          </div>
          {pageCount > 1 ? (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                data-testid={`${prefix}-previous-page`}
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                data-testid={`${prefix}-next-page`}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CapabilityRow({
  row, prefix, ctx, canMutate, editing, onEdit, onCloseEdit, onDisable,
}: {
  row: CapabilityListing;
  prefix: string;
  ctx: MutateContext;
  canMutate: boolean;
  editing: boolean;
  onEdit(): void;
  onCloseEdit(): void;
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
        {canMutate && !editing ? (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              data-testid={`${prefix}-row-${row.id}-edit`}
            >
              <Pencil aria-hidden className="h-3.5 w-3.5" />
              编辑
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
        {canMutate && editing ? (
          <CapabilityEditForm ctx={ctx} row={row} onClose={onCloseEdit} />
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
