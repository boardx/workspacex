"use client";

/**
 * 「切到在线正式系统」 —— 本地版里唯一的出口，且**先把代价说清楚再走**。
 *
 * ## 为什么是「在浏览器里打开」，而不是在应用内切过去
 *
 * 桌面版的 API / 数据库 / 模型全在本机（`packages/local-runtime`），它根本没有连在线集群
 * 的通路；应用内「切换」只能是假的。Electron 外壳把 `window.open` 交给系统浏览器
 * （`apps/desktop/src/main.ts` 的 `setWindowOpenHandler` → `shell.openExternal`），所以这里
 * 走一条标准的新窗口链接：在线系统开在浏览器里，本地窗口照旧是本地的——这也正是
 * `CLOUD_SWITCH_NOTES` 里那条「本地版不会被关掉」承诺的实现方式。
 *
 * ## 没配在线地址时不画死按钮
 *
 * `parseCloudUrl` 拿不到合法地址 ⇒ 对话框如实说这份安装包没配，并给出仍然可用的那条路
 * （把成果导出到正式组织）。本仓不许给用户一个点了没反应的按钮
 * （`lint-dead-controls.mjs` 管的正是这件事）。
 */
import * as React from "react";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { CAPABILITY_AVAILABILITY_LABEL, CLOUD_SWITCH_NOTES, capabilitiesMissingIn } from "@repo/contracts/deployment";
import { useCloudUrl } from "@/lib/edition";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/** 本地版切过去能多拿到的能力 = 本地版缺的那些。单一来源是契约的能力矩阵。 */
const GAINED = capabilitiesMissingIn("local");

export function EditionSwitch(): React.ReactElement {
  const cloudUrl = useCloudUrl();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        data-testid="edition-switch-open"
        onClick={() => setOpen(true)}
        className="gap-1 text-11 font-medium"
      >
        切到在线正式系统
        <ArrowUpRight aria-hidden className="h-3 w-3" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="edition-switch-dialog" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>切到在线正式系统</DialogTitle>
            <DialogDescription>
              在线系统会在浏览器里打开。走之前有四件事要先知道。
            </DialogDescription>
          </DialogHeader>

          <ul data-testid="edition-switch-notes" className="space-y-1.5">
            {CLOUD_SWITCH_NOTES.map((note) => (
              <li key={note.id} data-testid={`edition-switch-note-${note.id}`} className="text-12 text-muted-foreground">
                {note.statement}
              </li>
            ))}
          </ul>

          <div className="rounded-card border border-border-subtle bg-muted/40 p-2">
            <p className="mb-1 text-11 font-medium text-card-foreground">在线系统多出来的能力</p>
            <ul data-testid="edition-switch-gains">
              {GAINED.map((row) => (
                <li key={row.id} data-testid={`edition-switch-gain-${row.id}`} className="text-11 text-muted-foreground">
                  {row.capability}
                  <span className="mx-1 opacity-70">·</span>
                  本地版{CAPABILITY_AVAILABILITY_LABEL[row.local]}
                </li>
              ))}
            </ul>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} data-testid="edition-switch-cancel">
              留在本地版
            </Button>
            {cloudUrl === null ? (
              // 没配地址：说清楚是什么状况 + 还能做什么，而不是一个点了没反应的按钮
              <p data-testid="edition-switch-unconfigured" className="text-11 text-warning-foreground">
                这份安装包还没配在线系统的地址，没法直接打开。请向提供这份安装包的人要在线地址。
                本机的成果不受影响：在产出上用「下载」保存下来，之后在在线系统里上传即可。
              </p>
            ) : (
              <Button asChild data-testid="edition-switch-confirm">
                {/* 新窗口：Electron 外壳会把它交给系统浏览器，本地窗口不受影响 */}
                <a href={cloudUrl} target="_blank" rel="noopener noreferrer">
                  在浏览器里打开在线系统
                  <ExternalLink aria-hidden className="ml-1 h-3 w-3" />
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
