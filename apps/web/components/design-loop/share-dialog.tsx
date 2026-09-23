"use client";
/**
 * 迭代 22 —— 发布与分享的弹窗。
 *
 * ## 这一屏要说清三件事，少一件就会出事
 *
 *   ① **链接是谁都能打开的**。不说，用户会以为它和别的内部链接一样要登录，
 *      于是把不该外发的稿子发出去；说了，选哪一档才有意义。
 *   ② **发出去的是一份冻结的快照**。不说，用户以为对方永远看到最新的——这正是本仓
 *      那条「静态痕迹 ≠ 动态事实」：屏上"已分享"写下来就不再变，画布却还在改。
 *      所以当服务端说 `stale` 时，这里必须给出"更新发布"这个动作，而不只是一句提示。
 *   ③ **取消发布是真的收回**。旧链接立刻失效，再发是一条新链接。
 */
import * as React from "react";
import { Check, Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { designShareUrl, type DesignProject, type DesignShareScope } from "@/lib/live-design-workbench";
import { useDialogFocus } from "./use-dialog-focus";
import { humanTime } from "@/lib/human-time";

/** 两档的人话。闭集来自契约——漏一档编译不过。 */
export const SHARE_SCOPE_LABEL: Record<DesignShareScope, string> = {
  prototype: "只给原型",
  full: "原型 + 问题与验收标准",
};
const SHARE_SCOPE_HINT: Record<DesignShareScope, string> = {
  prototype: "对方只看得到页面本身。适合发给外部评审、客户。",
  full: "一并带上「问题与目标」和验收标准——这两段常常是从内部对话导进来的，确认过再选。",
};

export function ShareDialog({
  project, busy, error, onClose, onPublish, onUnpublish,
  /** 测试注入：jsdom 里没有 `window.location.origin` 之外的可控值，也没有剪贴板。 */
  origin = typeof window === "undefined" ? "" : window.location.origin,
  copy,
}: {
  project: DesignProject;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onPublish: (scope: DesignShareScope) => void;
  onUnpublish: () => void;
  origin?: string;
  copy?: (text: string) => Promise<void>;
}): React.ReactElement {
  /* `?? null`：夹具/旧响应里可能没有这个字段（契约有 default，但 `apiRequest` 不过 zod）。 */
  const share = project.share ?? null;
  const [scope, setScope] = React.useState<DesignShareScope>(share?.scope ?? "prototype");
  const [copied, setCopied] = React.useState(false);
  /**
   * 迭代 29：复制失败原来只是 `setCopied(false)` —— 也就是**什么都不说**。
   * 非安全上下文（http 的内网地址）与没给剪贴板权限都会走到这里，而这恰恰是
   * "我要把链接发给别人"那一步；一声不吭等于让人以为复制成功了，然后粘出去一片空白。
   */
  const [copyFailed, setCopyFailed] = React.useState(false);
  /**
   * 迭代 39（UIUX 第 20 轮）：「取消发布」原来**一点就收回**。这一屏自己在最后一行写着
   * 「旧的不会恢复」——那正是必须先问一句的理由：链接可能已经发给客户了，收回之后
   * 对方再点开就是一句「打不开」，而设计者不会知道这件事发生过。
   */
  const [confirmUnpublish, setConfirmUnpublish] = React.useState(false);
  /** 复制成功那 1.6 秒的定时器：卸载/重复点要清，否则弹窗关了还往没了的组件里写。 */
  const copyTimer = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
  }, []);
  /** B6.5：焦点进弹窗 / Esc 关闭 / 关掉之后焦点回到「分享」那个按钮——这一屏此前一条都没有。 */
  const panelRef = React.useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, onClose);
  /** 一页都没画出来时服务端会拒（`NOTHING_TO_PUBLISH`）；屏上先说清楚，别让用户点了才知道。 */
  const nothingToPublish = !project.prototype.some((r) => r !== null);
  const url = share?.token === null || share?.token === undefined ? null : designShareUrl(origin, share.token);

  const doCopy = async () => {
    if (url === null) return;
    const write = copy ?? (async (t: string) => navigator.clipboard.writeText(t));
    try {
      await write(url);
      setCopied(true);
      setCopyFailed(false);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪贴板被浏览器拒了（非安全上下文、权限没给）——链接本身就在输入框里，选中复制即可。
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <div className="dark fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="design-share-dialog">
      <div className="absolute inset-0 bg-inverse/50" onClick={onClose} aria-hidden />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="发布与分享" className="relative flex w-full max-w-lg flex-col gap-3 rounded-card border border-border bg-card p-5 text-card-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <h3 className="text-16 font-semibold">分享「{project.name}」</h3>

        {share === null ? (
          <p className="text-12 text-muted-foreground">
            发布之后会得到一条链接，<strong className="font-medium text-card-foreground">任何拿到链接的人都能打开，不需要登录</strong>。
            对方看到的是<strong className="font-medium text-card-foreground">发布这一刻</strong>的快照——之后你怎么改画布都不影响已经发出去的那一份。
          </p>
        ) : (
          <p className="text-12 text-muted-foreground" data-testid="design-share-published-at">
            发布于 {humanTime(share.publishedAt)} · 带出去的是「{SHARE_SCOPE_LABEL[share.scope]}」
          </p>
        )}

        {/* 档位：发布前选，发布后改了要按「更新发布」才生效——所以这里不在切换时自动发请求。 */}
        <fieldset className="flex flex-col gap-1.5" disabled={busy}>
          <legend className="text-11 font-medium text-muted-foreground">带出去多少</legend>
          {(Object.keys(SHARE_SCOPE_LABEL) as DesignShareScope[]).map((s) => (
            <label key={s} className={cn("flex cursor-pointer gap-2 rounded-control border p-2 text-12", scope === s ? "border-primary" : "border-border")}>
              <input
                type="radio"
                name="design-share-scope"
                value={s}
                checked={scope === s}
                onChange={() => setScope(s)}
                data-testid={`design-share-scope-${s}`}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{SHARE_SCOPE_LABEL[s]}</span>
                <span className="text-11 text-muted-foreground">{SHARE_SCOPE_HINT[s]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {url !== null && (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="分享链接"
              data-testid="design-share-url"
              className="min-w-0 flex-1 rounded-control border border-border bg-background px-2 py-1.5 font-mono text-11"
            />
            <Button variant="outline" size="sm" onClick={() => void doCopy()} data-testid="design-share-copy">
              {copied ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
              {copied ? "已复制" : "复制"}
            </Button>
          </div>
        )}
        {copyFailed && (
          <p className="text-11 text-muted-foreground" role="alert" data-testid="design-share-copy-failed">
            这个浏览器不让网页写剪贴板。链接就在上面那一栏里——点一下会自动选中，按 Ctrl/⌘ + C 复制。
          </p>
        )}

        {/*
          * 快照过期——这句话是本仓那条「静态痕迹 ≠ 动态事实」在界面上的落点：
          * 不说，用户以为对方看到的是最新稿，对方看到的是三轮之前，而两边都不会发现。
          */}
        {share !== null && share.stale && (
          <p className="rounded-control border border-warning/40 bg-warning/10 px-2 py-1.5 text-11" data-testid="design-share-stale">
            画布在发布之后改过了，对方现在看到的还是旧的那一份。要让他们看到最新的，按「更新发布」。
          </p>
        )}

        {/*
          * 档位是发布时定的，改了下拉不等于改了那条链接。不说这句，用户切到「原型 + 问题与
          * 验收标准」就关掉弹窗，以为对方已经看得到——而对方看到的还是只有原型的那一份。
          */}
        {share !== null && scope !== share.scope && (
          <p className="rounded-control border border-warning/40 bg-warning/10 px-2 py-1.5 text-11" data-testid="design-share-scope-pending">
            档位改成了「{SHARE_SCOPE_LABEL[scope]}」，但要按「更新发布」才对已经发出去的链接生效。
          </p>
        )}

        {nothingToPublish && (
          <p className="text-11 text-muted-foreground" data-testid="design-share-nothing">
            还没有画出来的页。发一条打开是白屏的链接，对方只会以为链接坏了——先生成原型再分享。
          </p>
        )}
        {error !== null && <p className="text-11 text-destructive" role="alert" data-testid="design-share-error">{error}</p>}

        <div className="mt-1 flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || nothingToPublish}
            onClick={() => onPublish(scope)}
            data-testid="design-share-publish"
          >
            {share === null ? <Link2 aria-hidden className="h-3.5 w-3.5" /> : <RefreshCw aria-hidden className="h-3.5 w-3.5" />}
            {share === null ? "发布并生成链接" : "更新发布"}
          </Button>
          {share !== null && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmUnpublish(true)} data-testid="design-share-unpublish">
              <Trash2 aria-hidden className="h-3.5 w-3.5" /> 取消发布
            </Button>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose} disabled={busy} data-testid="design-share-close">关闭</Button>
        </div>
        {confirmUnpublish && (
          <div className="flex flex-col gap-2 rounded-control border border-destructive/40 bg-destructive/10 p-2" data-testid="design-share-unpublish-confirm" role="alertdialog" aria-label="确认取消发布">
            <p className="text-11">
              收回这条链接？已经拿到它的人马上就打不开了，而且他们不会收到任何通知；再发布会是一条新链接，旧的不会恢复。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" data-testid="design-share-unpublish-cancel" onClick={() => setConfirmUnpublish(false)}>算了</Button>
              <Button variant="destructive" size="sm" data-testid="design-share-unpublish-yes" disabled={busy}
                onClick={() => { setConfirmUnpublish(false); onUnpublish(); }}>
                收回这条链接
              </Button>
            </div>
          </div>
        )}
        {share !== null && !confirmUnpublish && (
          <p className="text-10 text-muted-foreground">
            取消发布后这条链接立刻失效；再发布会是一条新的链接，旧的不会恢复。
          </p>
        )}
      </div>
    </div>
  );
}
