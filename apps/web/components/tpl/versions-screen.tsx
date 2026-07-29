"use client";
import * as React from "react";
import { History, RotateCcw, Lock, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { VERSION_HISTORY, CONFIG_ITEMS, type BlueprintVersion } from "@/lib/mock/tpl";
import { ConfirmDialog, SignoffFlag } from "./parts";

const labelOf = (key: string) => CONFIG_ITEMS.find((i) => i.key === key)?.label ?? key;

export function VersionsScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
  const [rollback, setRollback] = React.useState<BlueprintVersion | null>(null);
  const current = VERSION_HISTORY[0]!; // v4 当前已发布
  const nextVersion = current.versionNumber + 2; // 回滚 = 新建 v(n+1)；此处示意 v6

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4" data-testid="tpl-versions">
      <header className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <h1 className="text-20 font-bold tracking-tight">版本与锁定 · HMW 定题项目</h1>
          <Badge tone="primary">当前 v{current.versionNumber}</Badge>
        </div>
        <p className="text-12 text-muted-foreground">改动生成 v{current.versionNumber + 1}，已开过的项目锁在自己的版本上。</p>
      </header>

      <SignoffFlag kind="confirmed-missing" title="版本历史屏 / 回滚入口与确认框 / 删除影响面 —— 已探明区确认缺失，补画" testid="tpl-versions-flag">
        蓝本设计器与列表页均无版本历史、回滚入口、删除影响提示。本屏是补画草案。回滚语义按 O-18②：新建一个内容等同旧版的新版本（历史线性、版本号只增不减，带 rolled_back_from）。
      </SignoffFlag>

      <StateShell
        state={uiState}
        skeletonRows={5}
        emptyHint="这个蓝本还只有草稿，尚无已发布版本历史。"
        errors={{ "rollback": "回滚被拒：目标 v4 正被 3 个进行中项目使用；只能回滚到未被任何进行中项目使用的版本。" }}
        depFailure={{ what: "版本存储暂不可用：版本差异与回滚计算已暂停，元数据来自缓存仅供查看。" }}
        denial={{ layer: "organization", reason: "发布 / 归档 / 回滚 / 删除属方法负责人；观察者与组员无权进入。" }}
        successMessage={`已回滚：生成 v${nextVersion}（内容等同 v3），v3 与 v5 记录不变，rolled_back_from=v3`}
      >
        <ul className="flex flex-col gap-2" data-testid="tpl-version-list">
          {VERSION_HISTORY.map((v) => (
            <li key={v.versionNumber} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3" data-testid="tpl-version-row">
              <div className="flex flex-wrap items-center gap-2">
                {v.versionNumber === current.versionNumber
                  ? <CircleDot aria-hidden className="h-3.5 w-3.5 text-primary" />
                  : <History aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="text-13 font-semibold">v{v.versionNumber}</span>
                {v.state === "published"
                  ? <Badge tone="primary">已发布 · 当前</Badge>
                  : <Badge tone="neutral">已归档</Badge>}
                {v.rolledBackFrom && <Badge tone="outline">回滚自 v{v.rolledBackFrom}</Badge>}
                {v.usedByActiveProjects > 0 && <Badge tone="warning" data-testid="tpl-version-locked"><Lock aria-hidden className="h-2.5 w-2.5" /> {v.usedByActiveProjects} 个进行中项目锁定</Badge>}
              </div>
              <div className="text-11 text-muted-foreground">
                {v.publishedBy} 发布于 {v.publishedAt}
              </div>
              <div className="flex flex-wrap items-center gap-1" data-testid="tpl-version-diff">
                <span className="text-10 text-muted-foreground">改了：</span>
                {v.changedConfigItemKeys.length
                  ? v.changedConfigItemKeys.map((k) => <Badge key={k} tone="outline">{labelOf(k)}</Badge>)
                  : <span className="text-10 text-muted-foreground">首版</span>}
              </div>
              {v.versionNumber !== current.versionNumber && (
                <div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={v.usedByActiveProjects > 0}
                    onClick={() => setRollback(v)}
                    data-testid="tpl-version-rollback"
                  >
                    <RotateCcw aria-hidden className="h-3 w-3" /> 回滚到此版
                  </Button>
                  {v.usedByActiveProjects > 0 && <span className="ml-2 text-10 text-muted-foreground">正被进行中项目使用，不能作为回滚目标</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </StateShell>

      <ConfirmDialog
        open={!!rollback}
        tone="primary"
        title={`回滚到 v${rollback?.versionNumber} 的内容？`}
        confirmLabel="确认回滚"
        requireReason
        onConfirm={() => { onToast(`已回滚：生成 v${nextVersion}（内容等同 v${rollback?.versionNumber}），历史线性、版本号只增不减`); setRollback(null); }}
        onClose={() => setRollback(null)}
        impact={
          <div className="flex flex-col gap-1">
            <p>回滚不是把指针拨回去：将<b>新建 v{nextVersion}</b>，内容等同 v{rollback?.versionNumber}，记录 <code>rolled_back_from=v{rollback?.versionNumber}</code>。</p>
            <p className="text-muted-foreground">v{rollback?.versionNumber} 与当前 v4 记录均保持不变；已开过的项目仍锁在各自版本。</p>
            <p className="text-muted-foreground">理由（为什么回滚）将进审计。</p>
          </div>
        }
      />
    </div>
  );
}
