"use client";

/**
 * #458 —— Agent / Skill 目录的写入口。
 *
 * ## 这里没有权限判断
 *
 * 调用方按缓存下来的 `orgRole` 决定要不要挂载这些控件，那只是**降噪**：
 * 少给非管理员看一堆点了必然失败的按钮。真正的拒绝在服务端
 * （`POST /capabilities/mutate` → `mutateCapability`：401 / 403 / 404），
 * 而这些控件的责任是把服务端的裁决**如实显示出来**——包括「客户端以为自己是管理员、
 * 服务端已经降权」这种时间差，那时用户必须看到 403 的 reasonCode，
 * 而不是一个看起来成功了的界面。
 *
 * ## 没有乐观更新
 *
 * mutate 成功后不把返回的 listing 塞进本地数组，而是让调用方重新 GET 一次目录。
 * 乐观插入的失效方式很安静：服务端出于可见性把这条记录挡在目录外，
 * 界面却一直显示它，直到用户下次刷新才发现「刚建的东西不见了」。
 */
import * as React from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import {
  addCapability,
  disableCapability,
  updateCapability,
  type CapabilityKind,
  type CapabilityListing,
  type DisableMode,
  type MutateCapabilityResult,
  type VisibilityScope,
} from "@/lib/live-capabilities";

/** 服务端说了什么就显示什么。`reasonCode` 优先——它是分层的，HTTP 状态码不是。 */
export function describeMutateError(error: unknown): string {
  if (error instanceof ApiError) return error.reasonCode ?? `HTTP ${error.status}`;
  if (error instanceof Error) return error.message;
  return "未知错误";
}

// ⚠ `focus-visible:outline-none` 必须与 `focus-visible:ring-*` **同一行**：
//    lint-design 的 U7b 是逐行 grep 的，拆到两行会被判成「消除了焦点环却没给替代」。
const SELECT_CLASS =
  "h-8 w-full appearance-none rounded-md border border-input bg-card px-2.5 text-13 " +
  "text-card-foreground transition-all duration-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:bg-disabled disabled:text-disabled-foreground";

export interface MutateContext {
  readonly orgId: string;
  readonly kind: CapabilityKind;
  readonly prefix: string;
  readonly singular: string;
  /** 重新读取目录。返回 false = 读取没成功，界面必须说出来而不是假装刷新过。 */
  onMutated(result: MutateCapabilityResult): Promise<boolean>;
}

/* ───────────────────────────── 新增 ───────────────────────────── */

export function CapabilityCreatePanel({ ctx }: { ctx: MutateContext }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<VisibilityScope>("org-wide");
  const [ownerTeamId, setOwnerTeamId] = React.useState("");
  /**
   * #619：`kind === "agent"` 时必填——服务端 `mutateCapability` 的 add 分支
   * 与数据库 `capability_listings_agent_needs_abbr_duty` CHECK 都会拒绝空值，
   * 这里本地先挡一次给出字段级提示，同 `ownerTeamId`/`team-only` 那条的分工：
   * 真正的保证在服务端与数据库。
   */
  const [abbr, setAbbr] = React.useState("");
  const [duty, setDuty] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isAgent = ctx.kind === "agent";

  const reset = () => {
    setName("");
    setScope("org-wide");
    setOwnerTeamId("");
    setAbbr("");
    setDuty("");
    setError(null);
  };

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedTeam = ownerTeamId.trim();
    const trimmedAbbr = abbr.trim();
    const trimmedDuty = duty.trim();
    if (!trimmedName) {
      setError("名称不能为空。");
      return;
    }
    // 与契约的 superRefine 同一条规则：「仅某团队可见」却没说是哪个团队，
    // 不是更严的规则，是无法回答的规则。本地先挡一次只是为了给出字段级提示，
    // 服务端与数据库的 CHECK 才是保证——这里放行也不会写坏数据。
    if (scope === "team-only" && !trimmedTeam) {
      setError("仅团队可见时必须指定拥有它的团队。");
      return;
    }
    // #619：agent 目录条目缺 abbr/duty 会在服务端 400——本地先说清楚缺哪个字段。
    if (isAgent && (!trimmedAbbr || !trimmedDuty)) {
      setError("Agent 必须填写缩写与职责说明——AI 团队面板要求每个 agent 都说得出职责（I-17）。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await addCapability(ctx.orgId, ctx.kind, {
        name: trimmedName,
        scope,
        ...(scope === "team-only" ? { ownerTeamId: trimmedTeam } : {}),
        ...(isAgent ? { abbr: trimmedAbbr, duty: trimmedDuty } : {}),
      });
      const refreshed = await ctx.onMutated(result);
      if (!refreshed) return;
      setOpen(false);
      reset();
    } catch (e) {
      setError(describeMutateError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          data-testid={`${ctx.prefix}-create`}
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          新增 {ctx.singular}
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>新增 {ctx.singular}</CardTitle>
        <CardDescription>
          写入的是当前组织的能力目录。出现在目录中只代表它可被选择，不代表已经具备运行时。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-12">
            <span>名称</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              autoComplete="off"
              data-testid={`${ctx.prefix}-create-name`}
            />
          </label>
          <label className="flex flex-col gap-1 text-12">
            <span>可见范围</span>
            <select
              className={SELECT_CLASS}
              value={scope}
              disabled={busy}
              onChange={(e) => setScope(e.target.value as VisibilityScope)}
              data-testid={`${ctx.prefix}-create-scope`}
            >
              <option value="org-wide">全组织可见</option>
              <option value="team-only">仅团队可见</option>
            </select>
          </label>
          {scope === "team-only" ? (
            <label className="flex flex-col gap-1 text-12 sm:col-span-2">
              <span>拥有它的团队 ID</span>
              <Input
                value={ownerTeamId}
                onChange={(e) => setOwnerTeamId(e.target.value)}
                disabled={busy}
                autoComplete="off"
                data-testid={`${ctx.prefix}-create-owner-team`}
              />
            </label>
          ) : null}
          {isAgent ? (
            <>
              <label className="flex flex-col gap-1 text-12">
                <span>缩写</span>
                <Input
                  value={abbr}
                  onChange={(e) => setAbbr(e.target.value)}
                  disabled={busy}
                  autoComplete="off"
                  placeholder="团队面板徽标用，如 CS"
                  data-testid={`${ctx.prefix}-create-abbr`}
                />
              </label>
              <label className="flex flex-col gap-1 text-12 sm:col-span-2">
                <span>职责说明</span>
                <Input
                  value={duty}
                  onChange={(e) => setDuty(e.target.value)}
                  disabled={busy}
                  autoComplete="off"
                  placeholder="这个 agent 是做什么的（I-17：不能为空）"
                  data-testid={`${ctx.prefix}-create-duty`}
                />
              </label>
            </>
          ) : null}
        </div>

        {error ? (
          <p
            data-testid={`${ctx.prefix}-create-error`}
            className="text-12 text-destructive"
          >
            新增失败：{error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              reset();
            }}
          >
            取消
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void submit()}
            data-testid={`${ctx.prefix}-create-submit`}
          >
            {busy ? "提交中…" : "确认新增"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── 更新 ───────────────────────────── */

export function CapabilityEditForm({
  ctx, row, onClose,
}: {
  ctx: MutateContext;
  row: CapabilityListing;
  onClose(): void;
}) {
  const [name, setName] = React.useState(row.name);
  const [scope, setScope] = React.useState<VisibilityScope>(row.scope);
  // ⚠ 刻意**不预填**：`CapabilityListing` 是 `.strict()` 的，里面根本没有 `ownerTeamId`
  //   ——F15 把「归属哪个团队」留在服务端的 `facts` 里，不随目录下发。
  //   于是这里只能空着让管理员重新指定；填一个猜出来的值会把「我不知道」
  //   伪装成「就是这个团队」。契约的这个洞已在 issue #458 的评论里报给契约主人。
  const [ownerTeamId, setOwnerTeamId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = `${ctx.prefix}-row-${row.id}`;

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedTeam = ownerTeamId.trim();
    if (!trimmedName) {
      setError("名称不能为空。");
      return;
    }
    if (scope === "team-only" && !trimmedTeam) {
      setError("仅团队可见时必须指定拥有它的团队。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await updateCapability(ctx.orgId, ctx.kind, {
        id: row.id,
        name: trimmedName,
        scope,
        ...(scope === "team-only" ? { ownerTeamId: trimmedTeam } : {}),
      });
      const refreshed = await ctx.onMutated(result);
      if (!refreshed) return;
      onClose();
    } catch (e) {
      setError(describeMutateError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-12">
          <span>名称</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoComplete="off"
            data-testid={`${id}-name`}
          />
        </label>
        <label className="flex flex-col gap-1 text-12">
          <span>可见范围</span>
          <select
            className={SELECT_CLASS}
            value={scope}
            disabled={busy}
            onChange={(e) => setScope(e.target.value as VisibilityScope)}
            data-testid={`${id}-scope`}
          >
            <option value="org-wide">全组织可见</option>
            <option value="team-only">仅团队可见</option>
          </select>
        </label>
        {scope === "team-only" ? (
          <label className="flex flex-col gap-1 text-12 sm:col-span-2">
            <span>拥有它的团队 ID</span>
            <Input
              value={ownerTeamId}
              onChange={(e) => setOwnerTeamId(e.target.value)}
              disabled={busy}
              autoComplete="off"
              data-testid={`${id}-owner-team`}
            />
          </label>
        ) : null}
      </div>
      {error ? (
        <p data-testid={`${id}-error`} className="text-12 text-destructive">
          更新失败：{error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void save()} data-testid={`${id}-save`}>
          {busy ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── 停用 ───────────────────────────── */

/**
 * D-U5 的确认卡。
 *
 * ⚠ 「N 个进行中的调用会被中断」这句话**只能在停用完成后说**，因为服务端在停用之前
 * 才数得准（`mutateCapability` 里那段注释解释了为什么计数必须发生在应用 mode 之前），
 * 而这个计数是随响应回来的。这里不预先猜一个数字——猜出来的数字会让管理员
 * 以为自己是在有信息的情况下做的选择。
 */
export function CapabilityDisableDialog({
  ctx, row, onClose, onFailed,
}: {
  ctx: MutateContext;
  row: CapabilityListing;
  onClose(): void;
  onFailed(message: string): void;
}) {
  const [mode, setMode] = React.useState<DisableMode>("interrupt");
  const [busy, setBusy] = React.useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await disableCapability(ctx.orgId, ctx.kind, row.id, mode);
      await ctx.onMutated(result);
      onClose();
    } catch (e) {
      onFailed(describeMutateError(e));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-warning/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle aria-hidden className="h-4 w-4 text-muted-foreground" />
          停用「{row.name}」
        </CardTitle>
        <CardDescription>
          停用后它不再出现在可选择的目录里。受影响的进行中调用数由服务端在停用时统计并返回。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-12 sm:max-w-xs">
          <span>进行中的调用如何处理</span>
          <select
            className={SELECT_CLASS}
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value as DisableMode)}
            data-testid={`${ctx.prefix}-disable-mode`}
          >
            <option value="interrupt">立即中断（安全事件）</option>
            <option value="drain">允许跑完当前一轮（版本下线）</option>
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void confirm()}
            data-testid={`${ctx.prefix}-disable-confirm`}
          >
            {busy ? "停用中…" : "确认停用"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
