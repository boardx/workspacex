"use client";
import * as React from "react";
import { ArrowLeft, Check, Eye, Play, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  CONFIG_ITEMS, CONFIG_GROUPS, configTotal, configDoneCount,
  blockingRequiredItems, publishBlockers, type ConfigItem,
} from "@/lib/mock/tpl";
import { PANEL_RENDERERS } from "./designer-panels";
import { ConfirmDialog, SignoffFlag } from "./parts";

const RULE = "蓝本管骨架与默认值，不管具体内容。套用后引导师可逐场覆盖，改动只影响那一场。";

export function DesignerScreen({
  uiState, previewRole: _previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
  const [selKey, setSelKey] = React.useState<string>(CONFIG_ITEMS[0]!.key);
  const [confirmPublish, setConfirmPublish] = React.useState(false);

  const total = configTotal();
  const done = configDoneCount();
  const blockers = publishBlockers(); // 界面真正演示的门槛：降级 Skill 未替换（原型明写）
  const requiredBlocking = blockingRequiredItems(); // D-2 未定的次级清单，仅作提示
  const nextVersion = 5;
  const selected = CONFIG_ITEMS.find((i) => i.key === selKey)!;
  const Panel = PANEL_RENDERERS[selKey]!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1.5 border-b border-border px-4 py-3" data-testid="tpl-designer-header">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" aria-label="返回蓝本列表" data-testid="tpl-designer-back"><ArrowLeft aria-hidden className="h-4 w-4" /></Button>
          <h1 className="text-16 font-semibold">HMW 定题项目 · 蓝本设计</h1>
        </div>
        <p className="text-12 text-muted-foreground" data-testid="tpl-version-line">
          v4 已发布 · 用过 12 次 · <span className="text-background-foreground">改动生成 v{nextVersion}，已开过的项目锁在自己的版本上</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral" data-testid="tpl-autosave">草稿自动保存 · 14:52</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onToast("以参与者（组员）可见性渲染当前草稿 —— 只读，不改草稿、不产生版本")} data-testid="tpl-preview-participant"><Eye aria-hidden className="h-3.5 w-3.5" /> 预览参与者视图</Button>
            <Button size="sm" variant="outline" onClick={() => onToast("已用当前草稿开一场试跑实例，标记「已试跑」（不计入用过 N 次）")} data-testid="tpl-trial-run"><Play aria-hidden className="h-3.5 w-3.5" /> 试跑一场</Button>
            <Button size="sm" variant="primary" onClick={() => setConfirmPublish(true)} data-testid="tpl-publish"><Rocket aria-hidden className="h-3.5 w-3.5" /> 发布 v{nextVersion}</Button>
          </div>
        </div>
        <p className="rounded-md bg-panel px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpl-rule-sentence">{RULE}</p>
      </header>

      <StateShell
        state={uiState}
        className="flex min-h-0 flex-1"
        skeletonRows={8}
        emptyHint={`新建蓝本 · 0/${total} 已配。逐项填完即可预览、试跑、发布。`}
        errors={{
          publish: blockers.length
            ? `无法发布：${blockers.map((b) => b.reason).join("；")}。`
            : "无法发布：本草稿尚未试跑。点「试跑一场」后才能发布。",
        }}
        depFailure={{ what: "模型清单（20-model）暂不可用：基本配置的模型策略只能从已启用模型中选，现无法读取可选模型。" }}
        denial={{ layer: "project", reason: "观察者不能编辑蓝本，也看不到未发布草稿；只能只读查看已发布且脱敏的版本。" }}
        successMessage={`已发布 v${nextVersion}，旧版 v4 归档（已开过的项目仍锁在 v4）`}
      >
        <div className="flex min-h-0 w-full flex-col lg:flex-row" data-testid="tpl-designer-canvas">
          <ConfigDirectory total={total} done={done} selKey={selKey} onSelect={setSelKey} />
          <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="tpl-panel-body">
            <Panel item={selected} />
          </div>
        </div>
      </StateShell>

      <ConfirmDialog
        open={confirmPublish}
        title={`发布 v${nextVersion}？`}
        tone="primary"
        confirmLabel={blockers.length ? "有阻断项 · 无法发布" : `确认发布 v${nextVersion}`}
        onConfirm={() => { setConfirmPublish(false); onToast(`已发布 v${nextVersion}；旧版 v4 自动归档；已开过的项目仍锁在 v4`); }}
        onClose={() => setConfirmPublish(false)}
        impact={
          <div className="flex flex-col gap-1.5">
            <p>发布前校验（原型明写的门槛）：</p>
            {blockers.length
              ? blockers.map((b) => <p key={b.reason} className="flex items-start gap-1.5 text-destructive"><span>✗</span>{b.reason}</p>)
              : <p className="flex items-center gap-1.5 text-success">✓ 无降级 Skill，可发布</p>}
            <p className="text-muted-foreground">通过后生成 v{nextVersion}、旧版 v4 归档；<b>已开过的项目仍锁在自己的版本上</b>，不受影响。</p>
            {requiredBlocking.length > 0 && (
              <SignoffFlag kind="note" title="另有一份「必填项完成才能发布」的门槛清单未定（缺 D-2）">
                当前 16 项已全配（16/16），无未完成必填项。但「哪几项算必填」这份清单本身仍待人类给出，届时它会成为第二道门槛。
              </SignoffFlag>
            )}
          </div>
        }
      />
    </div>
  );
}

/* ── 左：16 面板目录 + 完成度侧栏 ─────────────────────────────────────── */

function ConfigDirectory({
  total, done, selKey, onSelect,
}: {
  total: number; done: number; selKey: string; onSelect: (k: string) => void;
}) {
  return (
    <aside className="shrink-0 overflow-y-auto border-b border-border p-3 lg:w-60 lg:border-b-0 lg:border-r" data-testid="tpl-config-directory">
      <div className="mb-2 flex items-baseline gap-2 px-1">
        {/* 原型原文「设计环节」按 D-03 已正名为「设计配置」；计数分母恒读表（禁止硬编码 16/15）*/}
        <span className="text-12 font-semibold">设计配置</span>
        <span className="font-mono text-11 text-success" data-testid="tpl-completion">{done} / {total}</span>
      </div>
      <Progress value={done} max={total} label={`完成度 ${done}/${total}`} className="mb-3" />
      {CONFIG_GROUPS.map((g) => {
        const items = CONFIG_ITEMS.filter((i) => i.group === g.key);
        return (
          <div key={g.key} className="mb-2">
            {g.divider && (
              <div className="mb-1 px-1 pt-2 text-10 uppercase tracking-wide text-muted-foreground" data-testid="tpl-config-group">{g.label}</div>
            )}
            <ul className="flex flex-col gap-0.5">
              {items.map((i) => (
                <li key={i.key}>
                  <button
                    type="button"
                    onClick={() => onSelect(i.key)}
                    data-testid="tpl-config-item"
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      i.key === selKey ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", i.done ? "bg-success" : "bg-muted-foreground/40")} />
                    <span className="flex-1 truncate">{i.label}</span>
                    {i.required && <Badge tone="outline" data-testid="tpl-required-tag">必填</Badge>}
                    {i.count && <span className="font-mono text-10 text-muted-foreground">{i.count}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className="mt-1 flex items-center gap-1 px-2 py-1 text-10 text-success" data-testid="tpl-config-groupdone">
        <Check aria-hidden className="h-3 w-3" /> 16 / 16 已配，可发布
      </div>
    </aside>
  );
}
