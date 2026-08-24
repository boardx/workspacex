"use client";

/**
 * 人类反馈（2026-08-17）：点击「编辑」应该打开一个新的界面，而不是在当前列表页里
 * 展开编辑区块。此前 `capability-catalog-screen.tsx` 的 `CapabilityRow` 把编辑表单
 * （名称/可见范围，skill 还带完整的文件树 + 代码编辑器）内联展开在列表行下方——
 * 一整个 Skill 编辑器挤在一行卡片里，本身就不是这块内容该有的空间。
 *
 * 本组件是那次内联展开的**替代**，渲染在独立路由 `/admin/[module]/[id]` 上：
 * 复用同一个 `CapabilityEditForm`（名称/可见范围）与调用方注入的 `renderEditExtra`
 * （skill 传 `SkillContentEditorSection`），只是把承载它们的容器从「列表行」换成
 * 「整页」，逻辑与鉴权路径一字不改——真正的写入口仍然是 `POST /capabilities/mutate`，
 * 这里不新开第二条。
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  listCapabilities,
  type CapabilityKind,
  type CapabilityListing,
  type MutateCapabilityResult,
} from "@/lib/live-capabilities";
import { CapabilityEditForm, type MutateContext } from "./capability-mutate";

type EditableKind = Extract<CapabilityKind, "agent" | "skill">;

/**
 * 编辑完成后回到哪——与 `[module]/page.tsx` 的 `REDIRECTS` 保持同一个目的地：
 * skill 目录真正呈现在 `/skill?screen=catalog`（`/admin/skill` 本身是重定向壳），
 * agent 目录呈现在 `/admin/agent`。
 */
const CATALOG_HREF: Record<EditableKind, string> = {
  agent: "/admin/agent",
  skill: "/skill?screen=catalog",
};

const SINGULAR: Record<EditableKind, string> = { agent: "Agent", skill: "Skill" };

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "not-found" }
  | { readonly status: "ready"; readonly row: CapabilityListing };

export function CapabilityEditPage({
  kind, id, renderEditExtra, compact = false,
}: {
  kind: EditableKind;
  id: string;
  /** 与 `capability-catalog-screen.tsx` 的同名 prop 同一份注入，见其头注。 */
  renderEditExtra?: (row: CapabilityListing) => React.ReactNode;
  /**
   * #1971 —— 人类截图实测反馈：`/admin/skill/[id]` 现在是全屏专注编辑模式（无左栏/
   * 顶栏 chrome），页面上半部分（返回链接 + 大标题 + id + 名称/可见范围表单）仍占了
   * 大段空间，把文件树 + 代码编辑器挤成不到一半屏幕。`compact` 把这段头部压成一行，
   * 让 `extra`（`SkillContentEditorSection`）拿到大部分高度。
   *
   * ⚠ 默认 `false`——`/admin/agent/[id]` 不传，保持原有（非全屏）布局不变。
   */
  compact?: boolean;
}) {
  const { session, identity } = useSession();
  if (!session) throw new Error("CapabilityEditPage requires an authenticated session");
  const orgId = session.currentOrgId;
  const prefix = `admin-${kind}-edit`;
  const canMutate = identity?.orgRole === "admin";
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [notice, setNotice] = React.useState<string | null>(null);
  const backHref = CATALOG_HREF[kind];

  const load = React.useCallback(async () => {
    setState({ status: "loading" });
    try {
      const rows = await listCapabilities(orgId, kind);
      const row = rows.find((r) => r.id === id);
      if (row === undefined) {
        setState({ status: "not-found" });
        return false;
      }
      setState({ status: "ready", row });
      return true;
    } catch (error) {
      setState({ status: "error", message: describeError(error) });
      return false;
    }
  }, [id, kind, orgId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const ctx: MutateContext | null = state.status === "ready"
    ? {
        orgId,
        kind,
        prefix: `admin-${kind}`,
        singular: SINGULAR[kind],
        async onMutated(result: MutateCapabilityResult) {
          setNotice(describeResult(result));
          return load();
        },
      }
    : null;

  return (
    <div
      className={compact ? "flex h-full min-h-0 flex-col gap-2 p-3" : "flex flex-col gap-5 p-6"}
      data-testid={`${prefix}-page`}
    >
      {/* #1971：compact 时这行连同 ready 态的名称/id 一起压成一条小字头部（见下方）。 */}
      {!compact && (
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1 text-12 text-muted-foreground transition-colors duration-200 hover:text-foreground"
          data-testid={`${prefix}-back`}
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          返回 {SINGULAR[kind]} 目录
        </Link>
      )}
      {compact && state.status !== "ready" && (
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1 text-11 text-muted-foreground transition-colors duration-base hover:text-foreground"
          data-testid={`${prefix}-back`}
        >
          <ArrowLeft aria-hidden className="h-3 w-3" />
          返回 {SINGULAR[kind]} 目录
        </Link>
      )}

      {state.status === "loading" ? (
        <div
          data-testid={`${prefix}-loading`}
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          正在读取…
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p data-testid={`${prefix}-error`} className="text-12 text-destructive">
            读取失败：{state.message}
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()} data-testid={`${prefix}-retry`}>
            重试
          </Button>
        </div>
      ) : null}

      {state.status === "not-found" ? (
        <div
          data-testid={`${prefix}-not-found`}
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          没有找到这条 {SINGULAR[kind]} 目录记录——可能已被停用移出目录，或不在你当前组织下。
        </div>
      ) : null}

      {state.status === "ready" && !canMutate ? (
        <div
          data-testid={`${prefix}-forbidden`}
          className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground"
        >
          只有组织管理员可以编辑 {SINGULAR[kind]} 目录项。
        </div>
      ) : null}

      {notice ? (
        <p data-testid={`${prefix}-notice`} className="text-12 text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {state.status === "ready" && canMutate && ctx ? (
        compact ? (
          <div className="flex h-full min-h-0 flex-col gap-2" data-testid={`${prefix}-compact-header`}>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={backHref}
                className="inline-flex shrink-0 items-center gap-1 text-11 text-muted-foreground transition-colors duration-base hover:text-foreground"
                data-testid={`${prefix}-back`}
              >
                <ArrowLeft aria-hidden className="h-3 w-3" />
                {SINGULAR[kind]} 目录
              </Link>
              <span className="h-3 w-px shrink-0 bg-border" aria-hidden />
              <span className="truncate text-13 font-semibold tracking-tight text-foreground">
                {state.row.name}
              </span>
              <span className="truncate font-mono text-9 text-muted-foreground">{state.row.id}</span>
            </div>
            <CapabilityEditForm
              ctx={ctx}
              row={state.row}
              onClose={() => {
                window.location.href = backHref;
              }}
              extra={renderEditExtra ? renderEditExtra(state.row) : undefined}
              compact
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <h1 className="text-18 font-semibold tracking-tight">{state.row.name}</h1>
            <p className="font-mono text-10 text-muted-foreground">{state.row.id}</p>
            <div className="mt-3">
              <CapabilityEditForm
                ctx={ctx}
                row={state.row}
                onClose={() => {
                  window.location.href = backHref;
                }}
                extra={renderEditExtra ? renderEditExtra(state.row) : undefined}
              />
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

/** 「N 个进行中的调用」是契约明确要求显示的答案——与 `capability-catalog-screen.tsx` 逐字同一份文案。 */
function describeResult(result: MutateCapabilityResult): string {
  return `已写入组织目录：${result.listing.name}（受影响的进行中调用 ${result.affectedInFlightCalls} 个，凭证 ${result.provenanceEventId}）`;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.reasonCode ?? `HTTP ${error.status}`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}
