"use client";
import * as React from "react";
import { Share2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  describeShareFailure, fetchProjectShareTargets, shareClaimToProject, unshareClaimFromProject, type ProjectShareTargets,
} from "@/lib/knowledge-graph-share-api";

type Target = ProjectShareTargets["targets"][number];
type Status = { readonly kind: "ok" | "error"; readonly message: string } | null;

/**
 * phase-18 S10（issue #4367）——个人记忆上的「分享到项目…」。/brain 的长期记忆列表与对话右栏的来源抽屉共用。
 *
 * 流程：点开 ⇒ 读 `listProjectShareTargets`（只有这条的主人读得到）⇒ 选一个项目 ⇒ **先看范围预览**（这个项目里
 * 谁会看到，含观察者）⇒ 确认分享（`shareToProject`，项目里多一份派生副本，标「由你分享自个人记忆」）。
 * 已分享的项目显示「已分享」，可以「撤回分享」（`unshareFromProject`：项目那份失效，个人原件不动）。
 * 数据全部来自服务端，不猜、不补；失败原因如实说在对话框里。
 */
export function ShareToProject({ claimId, testIdPrefix = "share" }: { claimId: string; testIdPrefix?: string }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<ProjectShareTargets | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<Status>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await fetchProjectShareTargets(claimId);
      setData(fresh);
      setSelected((cur) => (cur !== null && fresh.targets.some((t) => t.projectId === cur) ? cur : fresh.targets[0]?.projectId ?? null));
    } catch (e) {
      setData(null);
      setStatus({ kind: "error", message: describeShareFailure(e) });
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setStatus(null);
      void load();
    }
  };

  const target: Target | null = data?.targets.find((t) => t.projectId === selected) ?? null;

  const act = async (kind: "share" | "unshare", t: Target) => {
    setBusy(true);
    setStatus(null);
    try {
      if (kind === "share") {
        await shareClaimToProject(claimId, t.projectId);
        setStatus({ kind: "ok", message: `已分享到「${t.name}」。项目成员现在能看到它，项目对话里也会用到它。` });
      } else {
        await unshareClaimFromProject(claimId, t.projectId);
        setStatus({ kind: "ok", message: `已从「${t.name}」撤回。你的个人记忆原件还在。` });
      }
      await load();
    } catch (e) {
      setStatus({ kind: "error", message: describeShareFailure(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => onOpenChange(true)} data-testid={`${testIdPrefix}-open`}>
        <Share2 aria-hidden className="mr-1 h-3 w-3" />
        分享到项目…
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid={`${testIdPrefix}-dialog`} closeTestId={`${testIdPrefix}-close`}>
          <DialogHeader>
            <DialogTitle>分享到项目</DialogTitle>
            <DialogDescription>
              分享后，项目里会多一份副本，标明「由你分享自个人记忆」。你的个人记忆原件不受影响，随时可以撤回。
            </DialogDescription>
          </DialogHeader>

          {data !== null ? (
            <blockquote className="rounded-md border border-border-subtle bg-panel px-3 py-2 text-13" data-testid={`${testIdPrefix}-statement`}>
              {data.statement}
            </blockquote>
          ) : null}

          {loading && data === null ? (
            <p className="text-12 text-muted-foreground" aria-busy="true" data-testid={`${testIdPrefix}-loading`}>读取你的项目…</p>
          ) : data !== null && data.targets.length === 0 ? (
            <p className="text-12 text-muted-foreground" data-testid={`${testIdPrefix}-no-targets`}>
              你还没有可以分享进去的项目（要是项目成员；只能查看的观察者、已归档的项目不行）。
            </p>
          ) : data !== null ? (
            <div className="flex flex-col gap-3">
              <fieldset className="flex flex-col gap-1" aria-label="选择项目">
                <legend className="mb-1 text-11 font-semibold text-muted-foreground">选择项目</legend>
                {data.targets.map((t) => (
                  <label
                    key={t.projectId}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5 text-13 transition-colors duration-base hover:bg-muted"
                    data-testid={`${testIdPrefix}-target-${t.projectId}`}
                  >
                    <input
                      type="radio"
                      name={`${testIdPrefix}-${claimId}-project`}
                      checked={selected === t.projectId}
                      onChange={() => { setSelected(t.projectId); setStatus(null); }}
                    />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {t.sharedClaimId !== null ? <Badge tone="primary" data-testid={`${testIdPrefix}-shared-${t.projectId}`}>已分享</Badge> : null}
                  </label>
                ))}
              </fieldset>

              {target !== null ? (
                <section className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-muted p-2" data-testid={`${testIdPrefix}-audience`}>
                  <p className="flex items-center gap-1 text-12">
                    <Users aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    {target.sharedClaimId !== null ? "现在能看到它的人" : "确认后能看到它的人"}：「{target.name}」的全部 {target.audienceCount} 位成员
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {target.audience.map((m) => (
                      <span key={m.userId} className="rounded border border-border bg-card px-1.5 py-0.5 text-11" data-testid={`${testIdPrefix}-audience-member`}>
                        {m.displayName}
                      </span>
                    ))}
                    {target.audienceCount > target.audience.length ? (
                      <span className="text-11 text-muted-foreground">等 {target.audienceCount} 人</span>
                    ) : null}
                  </div>
                  <p className="text-11 text-muted-foreground">项目里的对话回答问题时也会用到它。项目外的人看不到。</p>
                </section>
              ) : null}
            </div>
          ) : null}

          {status !== null ? (
            <p
              role={status.kind === "error" ? "alert" : "status"}
              className={status.kind === "error" ? "text-12 text-destructive" : "text-12 text-background-foreground"}
              data-testid={`${testIdPrefix}-${status.kind === "error" ? "error" : "status"}`}
            >
              {status.message}
            </p>
          ) : null}

          <DialogFooter>
            {target !== null && target.sharedClaimId !== null ? (
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void act("unshare", target)} data-testid={`${testIdPrefix}-revoke`}>
                撤回分享
              </Button>
            ) : (
              <Button size="sm" variant="primary" disabled={busy || target === null} onClick={() => target !== null && void act("share", target)} data-testid={`${testIdPrefix}-confirm`}>
                确认分享
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
