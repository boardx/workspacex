"use client";
import * as React from "react";
import Link from "next/link";
import { Copy, Pencil, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { useSession } from "@/components/session/session-provider";
import {
  listBlueprints,
  createBlueprint,
  BLUEPRINT_STATE_LABEL,
  DURATION_TIER_LABEL,
  type BlueprintRow,
} from "@/lib/live-blueprints";

/**
 * BP-05（F1xx，track P P1）—— 「项目模板」生产入口（`/tpl/list`）真实接线。
 * BP-06：补上「编辑设计」真实链接（`/tpl/designer` 已能接受 `blueprintId` 参数）。
 *
 * ## 与原型 `BlueprintListScreen`（`lib/mock/tpl.ts`）的关系
 *
 * 那个组件仍然是 ADR-023 签核材料，继续挂在 `/tpl?screen=list` 原型切换器路径下，
 * 服务七态预览 + 卡片网格/标签过滤的视觉签核（#1158）——**不动它**。本组件是它的
 * 生产替身，只画契约 `BlueprintRow` 真实有的字段，不编 `tags`（那是原型探索性字段，
 * 契约没有）。
 *
 * ## 这次接了什么、没接什么
 *
 * 接：`GET /blueprints` 列表、`POST /blueprints`（origin=blank 新建 / origin=copy 复制）、
 *   「编辑设计」真实链到 `/tpl/designer?blueprintId=`（BP-06 已让该页面读真实数据）。
 * 没接：
 *   · 「从项目反向生成」——后端如实拒绝 `DEPENDENCY_UNAVAILABLE`（BP-01 头注），
 *     本屏直接不提供这个入口，不做一个点了必错的按钮。
 *   · 归档/删除——`availableActions` 由服务端派生，BP-01 至今恒返回空数组
 *     （对应端点还没实现），所以真实数据里这两个动作永远不出现，不是本屏忘画。
 *   · 换时长档位——设计器页面还没有对应交互入口（契约缺口 T13 已被 F186 解决，
 *     纯粹是前端交互还没做），见 `live-blueprints.ts` 头注。
 */
export function BlueprintListScreenLive() {
  const { session } = useSession();
  if (!session) throw new Error("BlueprintListScreenLive requires an authenticated session");
  const orgId = session.currentOrgId;

  const [rows, setRows] = React.useState<BlueprintRow[] | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [listBusy, setListBusy] = React.useState(false);

  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [createBusy, setCreateBusy] = React.useState(false);

  const refresh = React.useCallback(async (org: string) => {
    if (org === "") return;
    setListBusy(true);
    setListError(null);
    try {
      const out = await listBlueprints(org);
      setRows([...out]);
    } catch (e) {
      setListError(describeError(e));
      setRows(null);
    } finally {
      setListBusy(false);
    }
  }, []);

  React.useEffect(() => {
    setRows(null);
    void refresh(orgId);
  }, [orgId, refresh]);

  const submitCreate = async () => {
    if (createBusy) return;
    if (newName.trim() === "") {
      setCreateError("名称不能为空");
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createBlueprint({ orgId, name: newName.trim(), origin: "blank", sourceId: null });
      setCreating(false);
      setNewName("");
      await refresh(orgId);
    } catch (e) {
      setCreateError(describeError(e));
    } finally {
      setCreateBusy(false);
    }
  };

  const copyOne = async (source: BlueprintRow) => {
    try {
      await createBlueprint({
        orgId,
        name: `${source.name} 副本`,
        origin: "copy",
        sourceId: source.blueprintId,
      });
      await refresh(orgId);
    } catch (e) {
      setListError(describeError(e));
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4" data-testid="tpl-live-screen">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-20 font-bold tracking-tight">项目模板</h1>
          <p className="text-12 text-muted-foreground" data-testid="tpl-live-stats">
            {rows === null ? (listBusy ? "加载中…" : "—") : `${rows.length} 个`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" data-testid="tpl-live-refresh" onClick={() => refresh(orgId)} disabled={listBusy}>
            {listBusy ? "加载中…" : "刷新"}
          </Button>
          <Button size="sm" variant="primary" data-testid="tpl-live-new" onClick={() => { setCreating(true); setCreateError(null); }}>
            <Sparkles aria-hidden className="h-3.5 w-3.5" /> 新建模板
          </Button>
        </div>
      </header>

      {creating && (
        <Card data-testid="tpl-live-create-form">
          <CardContent className="flex flex-col gap-2 p-3">
            <Label htmlFor="tpl-live-new-name">从空白开始 · 模板名称</Label>
            <div className="flex items-center gap-2">
              <Input
                id="tpl-live-new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：客户共创工作坊"
                data-testid="tpl-live-new-name"
              />
              <Button size="sm" variant="primary" onClick={() => void submitCreate()} disabled={createBusy} data-testid="tpl-live-create-submit">
                {createBusy ? "创建中…" : "创建"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setCreateError(null); }} disabled={createBusy}>
                取消
              </Button>
            </div>
            {createError !== null && (
              <p className="text-11 text-destructive" data-testid="tpl-live-create-error">{createError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {listError !== null && (
        <p className="text-12 text-destructive" data-testid="tpl-live-list-error">{listError}</p>
      )}

      {rows === null ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground" data-testid="tpl-live-empty">
          {listBusy ? "加载中…" : listError !== null ? "加载失败" : "还没有任何模板"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-12 text-muted-foreground" data-testid="tpl-live-empty">
          当前组织还没有项目模板。点右上角「新建模板」从空白开始。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="tpl-live-grid">
          {rows.map((row) => (
            <BlueprintLiveCard key={row.blueprintId} row={row} onCopy={() => void copyOne(row)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BlueprintLiveCard({ row, onCopy }: { row: BlueprintRow; onCopy: () => void }) {
  return (
    <Card data-testid={`tpl-live-card-${row.blueprintId}`}>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-14 font-semibold" data-testid="tpl-live-card-name">{row.name}</span>
          <Badge tone={row.state === "published" ? "primary" : "outline"} data-testid="tpl-live-card-state">
            {BLUEPRINT_STATE_LABEL[row.state]}
            {row.state === "published" ? ` v${row.versionNumber}` : ""}
          </Badge>
        </div>

        <div className="flex flex-col gap-1 text-11 text-muted-foreground">
          <span>{DURATION_TIER_LABEL[row.durationTier]} · {row.agendaSegmentCount} 环节</span>
          <span>用过 {row.appliedProjectCount} 次</span>
          <span>
            {row.satisfaction === null ? "满意度 —" : `满意度 ${row.satisfaction.toFixed(1)}`}
          </span>
          <span data-testid="tpl-live-card-completion">
            {row.completeness.done}/{row.completeness.denominator} 已配
          </span>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {/* BP-06：designer 页面已能按 blueprintId 读真实数据，链接不再是死指针。 */}
          <Button size="xs" variant="outline" asChild data-testid="tpl-live-card-edit">
            <Link href={`/tpl/designer?blueprintId=${encodeURIComponent(row.blueprintId)}`}>
              <Pencil aria-hidden className="h-3 w-3" /> 编辑设计
            </Link>
          </Button>
          {/* ⚠ 不受 `availableActions` 门控：那个字段管的是契约里独立的
              `copyBlueprint`（`POST /blueprints/:id/copy`，未实现）这个动作，
              本按钮走的是另一条已实现路径——`createBlueprint({origin:'copy'})`，
              BP-01 起就真实可用（真库测试覆盖）。两者是契约里两条不同的复制路径
              （同类历史：#991 T9 也记过一次「同一件事两个入口」），本屏用现成能跑的
              那条，不等未实现的 `copyBlueprint` 落地。 */}
          <Button size="xs" variant="outline" onClick={onCopy} data-testid="tpl-live-card-copy">
            <Copy aria-hidden className="h-3 w-3" /> 复制
          </Button>
          {/* availableActions 由服务端派生（BP-01 头注：前端不得自行决定能不能删/归档）。
              archive/delete/rollback 三项对应的端点还没实现，BP-01 至今恒返回空数组，
              这不是本屏漏画。 */}
        </div>
      </CardContent>
    </Card>
  );
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.reasonCode ?? `操作失败（HTTP ${e.status}）`;
  if (e instanceof Error) return e.message;
  return "未知错误";
}
