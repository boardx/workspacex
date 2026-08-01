"use client";
import * as React from "react";
import { ChevronLeft, Link2, Info } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StateShell, StatePreviewSwitcher } from "@/components/state/state-shell";
import { SectionTitle, StatChip } from "./parts";
import type { Identity } from "@/lib/identity";
import type { UiState } from "@/lib/ui-state";
import { NEWPROJECT, BLUEPRINT_CATALOG } from "@/lib/mock/project";
import { INIT_CATEGORIES } from "@/lib/mock/tpl";
import { Badge } from "@/components/ui/badge";

/**
 * 新建项目向导（原型 wsCreateView）—— C-2 缺屏补齐。
 * 步骤 1：选蓝本九宫格 + 从空白 / 复制一场；步骤 2：主题与时长。
 *
 * ⚠ **处置了一处宣称已被否决模型的字段**：原型步骤 2 的「挂到哪个项目（决定能读哪些洞察与图谱）」
 *   （原型 byte 15208776）宣称父子项目模型（Q-12 候选 E），而 Q-12 已裁 C+D、E 未采纳。
 *   此处改成明确的**跨容器只读引用**「关联研究来源」，并挂一条 callout 说清它不是父子层级。
 *
 * ⚠ **F23 补的两处**：
 *   ① 六类初始化一览——复用 `lib/mock/tpl.ts` 的 `INIT_CATEGORIES`（与设计器面板 01
 *      的「套用后会初始化什么」同一份数据），不在本文件另开一份六类清单（同 I-17 的理由）。
 *   ② 「创建项目」按钮的双击/重复点击防护——契约 `applyBlueprint` 的幂等（V13）是后端
 *      靠 `idempotencyKey` 保证的，但界面层至少不该让同一次点击意图触发两次提交请求；
 *      本文件用本地状态把按钮在首次点击后置为已提交/禁用，不接后端（同本域 mock 的既有约束）。
 */
export function NewProjectFlow({
  identity, state,
}: { identity: Identity; state: UiState }) {
  const [picked, setPicked] = React.useState<string>(BLUEPRINT_CATALOG[0]!.id);
  const [submitted, setSubmitted] = React.useState(false);
  const [createCount, setCreateCount] = React.useState(0);
  const d = NEWPROJECT.defaults;
  const src = NEWPROJECT.linkedSources;

  const handleCreate = React.useCallback(() => {
    // ⚠ 幂等的界面表达：一旦已提交，后续点击一律不再触发（不会让 createCount 继续增长）。
    if (submitted) return;
    setSubmitted(true);
    setCreateCount((n) => n + 1);
  }, [submitted]);

  return (
    <AppShell identity={identity} previewRole={null}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6" data-testid="project-new">
        <header className="flex flex-col gap-2">
          <Button asChild size="sm" variant="outline" className="self-start" data-testid="project-new-back">
            <a href="/projects"><ChevronLeft aria-hidden className="h-3.5 w-3.5" />全部项目</a>
          </Button>
          <h1 className="text-20 font-semibold tracking-tight" data-testid="project-new-title">新建项目（工作坊）</h1>
          <p className="text-12 text-muted-foreground">
            一个项目就是一场工作坊：先选一套蓝本骨架，再填这一场的主题与时长。工作坊有四种项目角色；
            研究项目 / 用户洞察是另外两类独立容器，不在这里创建。
          </p>
        </header>

        <StatePreviewSwitcher current={state} />

        <StateShell
          state={state}
          emptyHint="还没有可套用的蓝本。先去蓝本设计器发布一个，或选「从空白开始」。"
          errors={{
            蓝本: "请先选择一个已发布的蓝本，或选「从空白开始 / 复制一场」",
            时长档位: "请选择一个时长档位（90 分钟 / 半天 / 全天 / 自定义）",
          }}
          depFailure={{ what: "蓝本服务（登录管理 / 蓝本发布）暂时不可用，无法列出可套用的蓝本" }}
          denial={{ layer: "organization", reason: "你的组织角色是观察者，没有新建项目的权限" }}
          successMessage="新项目已建成，已按蓝本预填议程、分组与输出物槽位"
        >
          <div className="flex flex-col gap-5">
            {/* 步骤 1：选蓝本 */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <StepDot n={1} />
                <SectionTitle className="mb-0" meta="蓝本决定环节骨架 · 每环节绑哪张画布 · AI 权限">选一套蓝本</SectionTitle>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="project-new-blueprints">
                {BLUEPRINT_CATALOG.map((b) => {
                  const on = picked === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setPicked(b.id)}
                      aria-pressed={on}
                      data-testid={`project-new-blueprint-${b.id}`}
                      className={[
                        "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted",
                      ].join(" ")}
                    >
                      <span className="text-12 font-medium">{b.name}</span>
                      <span className="text-10 text-muted-foreground">{b.desc}</span>
                      <span className="mt-1 font-mono text-9 text-muted-foreground">{b.meta}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2" data-testid="project-new-scratch">
                {NEWPROJECT.scratchOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setPicked(o.id)}
                    aria-pressed={picked === o.id}
                    data-testid={`project-new-scratch-${o.id}`}
                    className={[
                      "flex flex-col gap-0.5 rounded-lg border border-dashed p-3 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      picked === o.id ? "border-primary bg-primary/5" : "border-border bg-panel hover:bg-muted",
                    ].join(" ")}
                  >
                    <span className="text-12 font-medium">{o.title}</span>
                    <span className="text-10 text-muted-foreground">{o.desc}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-10 leading-relaxed text-muted-foreground">{NEWPROJECT.blueprintNote}</p>
            </section>

            {/* 步骤 2：主题与时长 */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <StepDot n={2} />
                <SectionTitle className="mb-0" meta="选完蓝本，把骨架伸缩成这一场的议程">主题与时长</SectionTitle>
              </div>
              <Card><div className="flex flex-col gap-3.5 p-4" data-testid="project-new-details">
                <Field label="项目名称">
                  <div className="flex h-9 items-center rounded-md border border-primary bg-card px-3 text-12" data-testid="project-new-name">{d.name}</div>
                </Field>

                {/* 处置后的字段：关联研究来源（原「挂到哪个项目」）*/}
                <Field label={src.label}>
                  <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3" data-testid="project-new-linked-source">
                    <Link2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-12">{src.value}</span>
                    <span className="font-mono text-10 text-muted-foreground">▾</span>
                  </div>
                  <div
                    data-testid="project-new-linked-source-note"
                    className="mt-1.5 flex items-start gap-2 rounded-md border border-ai/30 bg-ai-tint px-2.5 py-2 text-10 leading-relaxed text-ai-tint-foreground"
                  >
                    <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{src.note}</span>
                  </div>
                </Field>

                <Field label="时长档位">
                  <div className="flex flex-wrap gap-1.5" data-testid="project-new-duration">
                    {d.durationTiers.map((t) => {
                      const dashed = "dashed" in t && t.dashed;
                      return (
                        <span
                          key={t.id}
                          data-testid={`project-new-duration-${t.id}`}
                          className={[
                            "grid h-7 place-items-center rounded-md border px-3 text-11",
                            dashed ? "border-dashed border-border text-muted-foreground" : "",
                            t.on ? "border-primary bg-primary text-primary-foreground font-medium" : "border-border",
                          ].join(" ")}
                        >
                          {t.label}
                        </span>
                      );
                    })}
                  </div>
                </Field>

                <div className="flex flex-col gap-3.5 sm:flex-row">
                  <Field label="日期与开始时间" className="flex-1">
                    <div className="flex h-8 items-center rounded-md border border-border bg-card px-3 font-mono text-11" data-testid="project-new-datetime">{d.datetime}</div>
                  </Field>
                  <Field label="参与人数（决定分几组）" className="flex-1">
                    <div className="flex h-8 items-center rounded-md border border-border bg-card px-3 text-11" data-testid="project-new-headcount">{d.headcount}</div>
                  </Field>
                </div>
              </div></Card>
            </section>

            {/* 六类初始化一览（F23 AC2「逐项对得上」）——复用蓝本设计器同一份数据，不另开一份清单 */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <StepDot n={3} />
                <SectionTitle className="mb-0" meta="要么全部成功、要么整体回滚，不建半成品">套用后将初始化什么（六类）</SectionTitle>
              </div>
              <Card><ul className="flex flex-col gap-1.5 p-3" data-testid="project-new-init-preview">
                {INIT_CATEGORIES.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 text-11" data-testid="project-new-init-item">
                    <Badge tone="primary">{c.label}</Badge>
                    <span className="text-muted-foreground">{c.writes}</span>
                  </li>
                ))}
              </ul></Card>
            </section>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={handleCreate}
                disabled={submitted}
                data-testid="project-new-create"
                data-create-count={createCount}
              >
                {submitted ? "已创建" : "创建项目"}
              </Button>
              <Button size="sm" variant="ghost" className="transition-colors" data-testid="project-new-cancel">取消</Button>
              <span className="flex-1" />
              {submitted && (
                <span data-testid="project-new-created" className="text-11 text-muted-foreground">
                  已创建项目，绑定「{labelFor(picked)}」的具体版本快照（此后不随蓝本发布漂移）
                </span>
              )}
              <StatChip tone="ai">当前选择：{labelFor(picked)}</StatChip>
            </div>
          </div>
        </StateShell>
      </div>
    </AppShell>
  );
}

function labelFor(id: string): string {
  const bp = BLUEPRINT_CATALOG.find((b) => b.id === id);
  if (bp) return bp.name;
  const sc = NEWPROJECT.scratchOptions.find((o) => o.id === id);
  return sc ? sc.title : id;
}

function StepDot({ n }: { n: number }) {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-inverse font-mono text-10 text-inverse-foreground">{n}</span>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 text-10 text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
