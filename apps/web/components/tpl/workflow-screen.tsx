"use client";
import * as React from "react";
import { ArrowRight, Save, ListTodo, Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import {
  WORKFLOW_TEMPLATE, SEGMENT_CHAIN, MATRIX_ROLES, matrixRoleLabel, ORCH_MATRIX,
  TEMPLATE_LIBRARY,
} from "@/lib/mock/tpl";
import { ConfirmDialog, SignoffFlag } from "./parts";

export function WorkflowScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
  const [switchTo, setSwitchTo] = React.useState<string | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4" data-testid="tpl-workflow">
      <header className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <h1 className="text-20 font-bold tracking-tight">工作流编排</h1>
          <Badge tone="outline">项目 → 设置</Badge>
        </div>
        <p className="text-12 text-muted-foreground">改动只影响这场项目，不会动后台的模板本体。</p>
      </header>

      <StateShell
        state={uiState}
        skeletonRows={6}
        emptyHint="本项目还没套任何工作流模板。从模板库选一个，或从空白搭议程环节链。"
        errors={{ "workflow": "换模板被拒：整条环节链将被替换，已生成 9 条待办需先决定去留（保留孤儿 / 归档），不能静默丢弃。" }}
        depFailure={{ what: "任务模块（11-board）暂不可用：矩阵格 → 待办的同步无法确认，「看任务」与格子编辑已置灰以免产生不一致。" }}
        denial={{ layer: "project", reason: "只有引导师能编排工作流；组长/组员只能看自己那一列的职责，观察者不可见。" }}
        successMessage="已另存为组织级工作流模板（横向复制一份投影，不改上游、不需审核）"
      >
        {/* 7a 模板层 */}
        <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-wf-template">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-13 font-medium">{WORKFLOW_TEMPLATE.name}</span>
            <Badge tone="primary">已套用</Badge>
            <Badge tone="outline" data-testid="tpl-wf-source">{WORKFLOW_TEMPLATE.sourceVersion}</Badge>
          </div>
          {/* 议程环节链 */}
          <div className="flex flex-wrap items-center gap-1" data-testid="tpl-segment-chain">
            {SEGMENT_CHAIN.map((s, i) => (
              <React.Fragment key={s}>
                <Badge tone="neutral">{s}</Badge>
                {i < SEGMENT_CHAIN.length - 1 && <ChevronRight aria-hidden className="h-3 w-3 text-muted-foreground" />}
              </React.Fragment>
            ))}
          </div>
          <p className="text-10 text-muted-foreground">套用后你可以在「议程与材料」里改时长、增删环节、换绑模板与 skill。改动只影响这场项目，不会动后台的模板本体。</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onToast("进项目筹备 → 议程子标签细调")} data-testid="tpl-wf-refine"><ArrowRight aria-hidden className="h-3.5 w-3.5" /> 去议程里细调</Button>
            <Button size="sm" variant="outline" onClick={() => onToast("已另存为组织级工作流模板（产物是工作流模板，不是新蓝本；不需审核）")} data-testid="tpl-wf-saveorg"><Save aria-hidden className="h-3.5 w-3.5" /> 另存为组织模板</Button>
          </div>
        </section>

        {/* 7b 环节 × 三角色矩阵 */}
        <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-matrix">
          <div className="flex items-center gap-2">
            <span className="text-13 font-semibold">环节编排 · 每个环节三种角色各做什么</span>
            <Button size="xs" variant="outline" className="ml-auto" onClick={() => onToast("跳到任务模块，看这些格子生成的待办")} data-testid="tpl-matrix-tasks"><ListTodo aria-hidden className="h-3 w-3" /> 看任务</Button>
          </div>
          <p className="text-11 font-medium text-primary">编排一次，三套视图与待办自动生成</p>
          <div className="overflow-x-auto" data-allow-x-scroll="环节×三角色矩阵四列，窄屏允许横向滚动看全">
            <table className="w-full min-w-[720px] border-collapse text-11">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-1.5 font-medium">环节 · 绑定</th>
                  {MATRIX_ROLES.map((r) => <th key={r} className="px-2 py-1.5 font-medium" data-testid="tpl-matrix-col">{matrixRoleLabel(r)}</th>)}
                </tr>
              </thead>
              <tbody>
                {ORCH_MATRIX.map((row) => (
                  <tr key={row.segment} className="border-b border-border/60 align-top" data-testid="tpl-matrix-row">
                    <td className="px-2 py-2">
                      <div className="text-12 font-medium">{row.segment}</div>
                      <div className="text-10 text-muted-foreground" data-testid="tpl-matrix-binding">{row.binding}</div>
                    </td>
                    {MATRIX_ROLES.map((r) => (
                      <td key={r} className="px-2 py-2">
                        <span className="rounded-sm bg-panel px-1.5 py-1 text-11" data-testid="tpl-matrix-cell">{row.cells[r]}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="rounded-md bg-panel px-2.5 py-1.5 text-10 text-muted-foreground" data-testid="tpl-matrix-rule">
            每一格都会变成对应角色的一条待办，同步到「任务」里；组长切换环节状态后，三种视角的首屏立刻跟着换。
          </p>
          <SignoffFlag kind="backlog-conflict" title="矩阵格的内容粒度未定（缺 D-10）—— 直接决定「3×3 = 恰好 9 条待办」断言">
            「写 ≥1 张便签 · 投票」是一条待办还是两条？一格多条时 F27 的「恰好 9 条」就是错的。sign-off 请优先看。另：环节「（当前）」状态依赖项目侧的环节状态机（未定，见项目侧缺失概念）。
          </SignoffFlag>
        </section>

        {/* 7c 模板库 */}
        <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-template-library">
          <span className="text-13 font-semibold">可切换的工作流模板库</span>
          <ul className="flex flex-col gap-1.5">
            {TEMPLATE_LIBRARY.map((t) => (
              <li key={t.name} className="flex items-center gap-2 rounded-md border border-border p-2.5" data-testid="tpl-library-row">
                <div className="flex-1">
                  <div className="text-12 font-medium">{t.name}</div>
                  <div className="text-10 text-muted-foreground">{t.meta}</div>
                </div>
                <Button size="xs" variant="outline" onClick={() => setSwitchTo(t.name)} data-testid="tpl-library-switch">改用这个</Button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="w-fit" onClick={() => onToast("从空白搭议程环节链（矩阵为空，逐格填写）")} data-testid="tpl-library-blank"><Plus aria-hidden className="h-3.5 w-3.5" /> 从空白搭</Button>
        </section>
      </StateShell>

      <ConfirmDialog
        open={!!switchTo}
        tone="destructive"
        title={`换用工作流模板「${switchTo}」？`}
        confirmLabel="确认换模板"
        requireReason
        onConfirm={() => { onToast(`已换用「${switchTo}」`); setSwitchTo(null); }}
        onClose={() => setSwitchTo(null)}
        impact={
          <div className="flex flex-col gap-1">
            <p>换模板属破坏性操作：整条议程环节链将被 <b>{switchTo}</b> 替换。</p>
            <p className="text-muted-foreground">影响范围：当前 6 个议程环节 + 矩阵里已填的 9 格 + 已生成的 9 条待办。</p>
            <SignoffFlag kind="unexplored" title="换模板后已生成待办的处置策略未定（缺 D-11）">
              已填矩阵格、已产生现场数据如何处理，项目已开始后是否禁止换 —— 待裁。此处只演示「显式告知 + 影响范围」，不静默丢弃。
            </SignoffFlag>
          </div>
        }
      />
    </div>
  );
}
