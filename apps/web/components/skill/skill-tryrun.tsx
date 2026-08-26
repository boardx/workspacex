"use client";
import * as React from "react";
import { Play, RefreshCw, Pin, Upload, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import { Toast } from "@/components/admin/panel";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { ScreenHead, RoleGate } from "./skill-shared";
import {
  TRYRUN_SCENARIOS, TRYRUN_INPUT_MATERIAL, TRYRUN_PARAMS, TRYRUN_TRACE,
  TRYRUN_OUTPUT, TRYRUN_CHECKS, TRYRUN_META, type SkillView,
} from "@/lib/mock/skill";

/**
 * 试跑整屏（原型 isSkRun · 偏移 15728257）—— v2 补画。
 *
 * v1 把它降格成四行面板（只有 input/output）；此屏还原原型两栏：
 *   左（输入：测试场景 3 个 / 输入材料 / 运行参数 / 运行一次 · 跑全部用例）·
 *   右（运行结果：执行轨迹 / 输出 / 自动校验 4 条 / 存为回归用例 · 重跑）。
 * 自动校验与回归用例不需要沙箱（D-06 挡不住这条）——它们是对声明式契约输出的断言。
 */
export function SkillTryRun({ state, view }: { state: UiState; view: SkillView }) {
  const [scenario, setScenario] = React.useState(TRYRUN_SCENARIOS[0]!.id);
  const [toast, setToast] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <ScreenHead title={TRYRUN_META.title} uc="UC-3.1 · 试跑整屏">
        <span className="inline-flex items-center gap-2">
          <Badge tone="outline" className="font-mono">{TRYRUN_META.tag}</Badge>
          {TRYRUN_META.hint}
        </span>
      </ScreenHead>

      <RoleGate view={view} allow={["maintainer", "reviewer"]} what="试跑台">
        <StateShell
          state={state}
          skeletonRows={6}
          emptyHint="还没有任何回归用例——先跑一次、对结果满意后「存为回归用例」，这里就会积累起每次改动都会重跑的断言集。"
          errors={{
            scope: "契约校验失败：数据范围声明申请读取「客户 CRM」，越出提交人权限——试跑直接判失败、不产出输出，也不进回归用例。",
          }}
          depFailure={{ what: "试跑需调用 skill 声明的模型（claude-sonnet-4.6），该模型当前不可用；不静默换模型（对照 UC-20.3），已保留输入与运行参数，可安全重试。" }}
          denial={{ layer: "organization", reason: "试跑台仅能力维护者与方法论审核人可用；引导师/组员用下发的 skill，不试跑契约本体。" }}
          successMessage="已存为回归用例：这次的输入×输出被钉住，以后每次改契约都会重跑并比对，回归失败会拦住发布。"
        >
          <div className="grid gap-3 lg:grid-cols-[300px_minmax(360px,1fr)]">
            {/* 左：输入 */}
            <section className="flex flex-col rounded-xl border border-border-subtle bg-card" data-testid="skill-tryrun-input">
              <div className="border-b border-border-subtle bg-panel px-3 py-2 text-11 font-medium">输入</div>
              <div className="flex flex-col gap-4 p-3">
                {/* 测试场景 */}
                <div>
                  <p className="mb-2 text-10 uppercase tracking-wide text-muted-foreground">测试场景</p>
                  <div className="flex flex-col gap-1.5">
                    {TRYRUN_SCENARIOS.map((sc) => (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => setScenario(sc.id)}
                        data-testid={`skill-tryrun-scenario-${sc.id}`}
                        className={cn(
                          "rounded-lg border p-2.5 text-left transition-colors",
                          scenario === sc.id ? "border-inverse bg-panel" : "border-border-subtle hover:bg-panel",
                        )}
                      >
                        <p className={cn("text-11", scenario === sc.id && "font-medium")}>{sc.name}</p>
                        <p className="text-9 leading-relaxed text-muted-foreground">{sc.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
                {/* 输入材料 */}
                <div>
                  <p className="mb-2 text-10 uppercase tracking-wide text-muted-foreground">输入材料</p>
                  <div className="rounded-lg border border-border-subtle bg-panel p-2.5 text-10 leading-relaxed" data-testid="skill-tryrun-material">
                    {TRYRUN_INPUT_MATERIAL}
                  </div>
                  <Button size="sm" variant="ghost" className="mt-1.5 w-full border border-dashed border-border" onClick={() => setToast("已换一批测试材料（mock，不真调用）")} data-testid="skill-tryrun-swap-material">
                    <Upload aria-hidden className="h-3 w-3" /> 换一批材料
                  </Button>
                </div>
                {/* 运行参数 */}
                <div>
                  <p className="mb-2 text-10 uppercase tracking-wide text-muted-foreground">运行参数</p>
                  <div className="flex flex-col gap-1.5" data-testid="skill-tryrun-params">
                    {TRYRUN_PARAMS.map((p) => (
                      <div key={p.key} className="flex items-center gap-2 text-10">
                        <span className="flex-1 text-muted-foreground">{p.key}</span>
                        <span className="font-mono text-background-foreground">{p.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-auto flex gap-1.5 border-t border-border-subtle bg-panel p-3">
                <Button size="sm" variant="primary" className="flex-1" onClick={() => setToast("已运行一次（mock）：结果见右侧运行结果")} data-testid="skill-tryrun-run">
                  <Play aria-hidden className="h-3 w-3" /> 运行一次
                </Button>
                <Button size="sm" variant="outline" onClick={() => setToast("已跑全部回归用例（mock）：4/4 通过")} data-testid="skill-tryrun-run-all">跑全部用例</Button>
              </div>
            </section>

            {/* 右：运行结果 */}
            <section className="flex flex-col rounded-xl border border-border-subtle bg-card" data-testid="skill-tryrun-result">
              <div className="flex items-center gap-2 border-b border-border-subtle bg-panel px-3 py-2">
                <span className="flex-1 text-11 font-medium">运行结果</span>
                <span className="font-mono text-9 text-success" data-testid="skill-tryrun-cost">{TRYRUN_META.runCost}</span>
              </div>
              <div className="flex flex-col gap-3 p-3">
                {/* 执行轨迹 */}
                <div className="rounded-lg border border-border-subtle p-3" data-testid="skill-tryrun-trace">
                  <p className="mb-2 text-10 uppercase tracking-wide text-muted-foreground">执行轨迹</p>
                  <div className="flex flex-col gap-2">
                    {TRYRUN_TRACE.map((t, i) => (
                      <div key={i} className="flex items-start gap-2" data-testid={`skill-tryrun-trace-${i}`}>
                        <span className="mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded bg-success/15 text-success"><Check aria-hidden className="h-2.5 w-2.5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-11">{t.label}</p>
                          <p className="font-mono text-9 text-muted-foreground">{t.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* 输出 */}
                <div className="overflow-hidden rounded-lg border border-border-subtle" data-testid="skill-tryrun-output">
                  <div className="border-b border-border-subtle bg-panel px-3 py-2 font-mono text-10 text-muted-foreground">输出</div>
                  <pre className="whitespace-pre-wrap p-3 font-mono text-10 leading-relaxed text-background-foreground">{TRYRUN_OUTPUT}</pre>
                </div>
                {/* 自动校验（4 条） */}
                <div className="rounded-lg border border-border-subtle p-3" data-testid="skill-tryrun-checks">
                  <p className="mb-2 text-10 uppercase tracking-wide text-muted-foreground">自动校验</p>
                  <div className="flex flex-col gap-1.5">
                    {TRYRUN_CHECKS.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-10" data-testid={`skill-tryrun-check-${i}`}>
                        <Badge tone={c.pass ? "primary" : "danger"} className="font-mono">{c.pass ? "PASS" : "FAIL"}</Badge>
                        <span className="min-w-0 flex-1 text-background-foreground">{c.label}</span>
                        <span className="shrink-0 text-muted-foreground">{c.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-auto flex items-center gap-2 border-t border-border-subtle bg-panel p-3">
                <span className="flex-1 text-9 text-muted-foreground">{TRYRUN_META.regressionHint}</span>
                <Button size="sm" variant="outline" onClick={() => setToast("已存为回归用例：这次输入×输出被钉住，以后每次改都会重跑")} data-testid="skill-tryrun-save-regression">
                  <Pin aria-hidden className="h-3 w-3" /> 存为回归用例
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setToast("已重跑（mock）")} data-testid="skill-tryrun-rerun">
                  <RefreshCw aria-hidden className="h-3 w-3" /> 重跑
                </Button>
              </div>
            </section>
          </div>
        </StateShell>
      </RoleGate>
      <Toast message={toast} testid="skill-tryrun-toast" onDismiss={() => setToast(null)} />
    </div>
  );
}
