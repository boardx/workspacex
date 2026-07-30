"use client";
import * as React from "react";
import { Puzzle, PenLine, Save, ArrowRightLeft, ListTodo, AlertTriangle, PanelLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { ScreenHead, RoleGate, NewScreenTag, SegmentNamingNote } from "./skill-shared";
import {
  SEGMENTS, WORKFLOW_TEMPLATE, ALT_TEMPLATES, BINDABLE_POOL,
  SKILL_SOURCE_LABEL,
  type SkillView, type SegmentRow,
} from "@/lib/mock/skill";

const SLOT_KIND_LABEL = {
  skill: "skill",
  "canvas-template": "画布模板",
  "agent-output": "agent 产物",
} as const;
const SLOT_KIND_TONE = {
  skill: "primary",
  "canvas-template": "outline",
  "agent-output": "ai",
} as const;

export function SkillBinding({ state, view }: { state: UiState; view: SkillView }) {
  const [saveConfirm, setSaveConfirm] = React.useState(false);
  const [switchTo, setSwitchTo] = React.useState<string | null>(null);
  const [rebindOf, setRebindOf] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <ScreenHead title="工作流编排 · 绑定到环节与角色" uc="UC-3.2 R3/R7 · F63 F64">
        项目 → 设置 → 工作流编排：在<strong className="text-foreground">议程环节 × 三角色</strong>矩阵上把 skill 挂上去。
        实例级改动只影响这场项目、不回写后台模板本体。
      </ScreenHead>

      <RoleGate view={view} allow={["facilitator", "groupLead", "member", "observer", "maintainer"]} what="工作流编排">
        <StateShell
          state={state}
          skeletonRows={4}
          emptyHint="还没套用任何工作流模板——从下方候选选一个，或 [＋ 从空白搭]"
          errors={{ binding: "换绑失败：所选 skill 的可见性范围不覆盖当前用户，不在可绑定池内" }}
          depFailure={{ what: "待办同步到任务模块失败——N 条待办未同步，可重试；编排本身已保存。" }}
          denial={{ layer: "project", reason: "观察者可见环节结构，但不可见绑定的 skill 清单与运行按钮" }}
          successMessage="编排已保存 · 每个非空角色格已生成对应角色的一条待办并同步到任务模块"
        >
          {/* ① 工作流模板块 */}
          <section className="flex flex-col gap-2" data-testid="skill-binding-template">
            <Card>
              <CardContent className="flex flex-col gap-2 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-13 font-medium">{WORKFLOW_TEMPLATE.name}</span>
                  <Badge tone="primary">已套用</Badge>
                  <Badge tone="outline" data-testid="skill-binding-fromversion">{WORKFLOW_TEMPLATE.fromVersion}</Badge>
                </div>
                <p className="text-10 leading-relaxed text-muted-foreground">
                  环节链：{SEGMENTS.map((s) => s.name).join(" → ")}
                </p>
                <p className="rounded-md border border-border-subtle bg-panel px-2 py-1.5 text-10 text-muted-foreground">
                  套用后可在「议程与材料」里改时长、增删环节、换绑模板与 skill。
                  <strong className="text-foreground">改动只影响这场项目，不会动后台模板本体。</strong>
                  每条绑定记录 skill 版本，现场运行时用项目快照锁定的版本，不因发新版漂移（D-30）。
                </p>
                {view === "facilitator" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="xs" variant="outline" data-testid="skill-binding-refine">去议程里细调</Button>
                    <Button size="xs" variant="outline" onClick={() => setSaveConfirm(true)} data-testid="skill-binding-saveas">
                      <Save aria-hidden className="h-3 w-3" /> 另存为组织模板
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ② 环节编排矩阵 */}
          <section className="flex flex-col gap-2" data-testid="skill-binding-matrix">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-13 font-semibold">环节编排 · 每个环节三种角色各做什么</h2>
              <SegmentNamingNote />
            </div>
            <p className="text-10 text-muted-foreground">
              编排一次，三套视图与待办自动生成——这张表是三视角首屏与角色待办的<strong className="text-foreground">单一来源</strong>。
            </p>

            {/* 表头 */}
            <div className="hidden grid-cols-[1.6fr_1fr_1fr_1fr] gap-2 rounded-md bg-panel px-2 py-1.5 text-10 uppercase tracking-wide text-muted-foreground md:grid">
              <span>议程环节 · 绑定</span><span>引导师</span><span>组长</span><span>组员</span>
            </div>

            {SEGMENTS.map((seg) => (
              <MatrixRow
                key={seg.segmentRef}
                seg={seg}
                view={view}
                rebindOpen={rebindOf === seg.segmentRef}
                onRebind={() => setRebindOf((v) => (v === seg.segmentRef ? null : seg.segmentRef))}
              />
            ))}

            <div className="flex items-center gap-2">
              <Button size="xs" variant="ghost" data-testid="skill-binding-seetasks">
                <ListTodo aria-hidden className="h-3 w-3" /> 看任务
              </Button>
              <span className="text-9 text-muted-foreground">
                待办负责人恒为人，agent 记在独立「执行者」字段（D-39）。
              </span>
            </div>
          </section>

          {/* ③ 三视角首屏投影 + 画布左栏只读投影 */}
          <ThreeViewProjection view={view} />

          {/* ④ 可切换的其它工作流模板 */}
          {view === "facilitator" && (
            <section className="flex flex-col gap-2" data-testid="skill-binding-alts">
              <h2 className="text-13 font-semibold">可切换的其它工作流模板</h2>
              {ALT_TEMPLATES.map((t) => (
                <Card key={t.id} data-testid={`skill-alt-${t.id}`}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4">
                    <span className="text-12">{t.name} · {t.segments} 环节</span>
                    <Button size="xs" variant="outline" onClick={() => setSwitchTo(t.id)} data-testid={`skill-alt-switch-${t.id}`}>
                      <ArrowRightLeft aria-hidden className="h-3 w-3" /> 改用这个
                    </Button>
                  </CardContent>
                </Card>
              ))}
              <Button size="xs" variant="ghost" data-testid="skill-binding-blank">＋ 从空白搭</Button>
            </section>
          )}
        </StateShell>
      </RoleGate>

      {saveConfirm && <SaveAsDialog onClose={() => setSaveConfirm(false)} />}
      {switchTo && (
        <OrphanDialog
          templateName={ALT_TEMPLATES.find((t) => t.id === switchTo)?.name ?? ""}
          onClose={() => setSwitchTo(null)}
        />
      )}
    </div>
  );
}

/* ── 矩阵行：混合槽（可区分）＋ 三角色格（各生成待办）───────────────── */

function MatrixRow({
  seg, view, rebindOpen, onRebind,
}: {
  seg: SegmentRow;
  view: SkillView;
  rebindOpen: boolean;
  onRebind: () => void;
}) {
  const canEdit = view === "facilitator" || view === "maintainer";
  return (
    <Card data-testid={`skill-seg-row-${seg.segmentRef}`} className={seg.current ? "border-primary/40" : undefined}>
      <CardContent className="grid grid-cols-1 gap-2 pt-4 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        {/* 绑定列 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-12 font-medium">{seg.index} {seg.name}</span>
            <span className="text-9 text-muted-foreground">{seg.minutes}m</span>
            {seg.current && <Badge tone="primary">当前</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-1" data-testid={`skill-seg-slots-${seg.segmentRef}`}>
            {seg.slots.length === 0 && <span className="text-9 text-muted-foreground">未绑定</span>}
            {seg.slots.map((slot, i) => (
              <Badge key={i} tone={SLOT_KIND_TONE[slot.kind]} className="gap-1">
                <Puzzle aria-hidden className="h-3 w-3" />
                <span className="text-9 opacity-70">{SLOT_KIND_LABEL[slot.kind]}</span>
                {slot.name}
                {"version" in slot ? <span className="font-mono opacity-70">{slot.version}</span> : null}
              </Badge>
            ))}
          </div>
          {canEdit && (
            <Button size="xs" variant="ghost" onClick={onRebind} data-testid={`skill-seg-rebind-${seg.segmentRef}`}>
              <PenLine aria-hidden className="h-3 w-3" /> 换绑 skill
            </Button>
          )}
          {rebindOpen && (
            <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel p-2" data-testid={`skill-seg-pool-${seg.segmentRef}`}>
              <span className="text-9 uppercase tracking-wide text-muted-foreground">可绑定池（已启用 ∩ 可见性覆盖你）</span>
              {BINDABLE_POOL.map((p) => (
                <button key={p.id} className="flex items-center justify-between rounded-sm px-1.5 py-1 text-10 text-foreground transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`skill-seg-pool-opt-${p.id}`}>
                  <span>{p.name} <span className="font-mono opacity-60">{p.version}</span></span>
                  <span className="opacity-60">{SKILL_SOURCE_LABEL[p.source]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 三角色格（各生成待办） */}
        {(["facilitator", "groupLead", "member"] as const).map((role) => (
          <div key={role} className="flex flex-col gap-1 rounded-md border border-border-subtle bg-panel/50 p-2">
            <span className="text-11">{seg.roles[role]}</span>
            <Badge tone="outline" className="w-fit gap-1" data-testid={`skill-seg-todo-${seg.segmentRef}-${role}`}>
              <ListTodo aria-hidden className="h-3 w-3" /> 待办 · 负责人=人
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ── 三视角首屏 + 画布左栏只读投影 ─────────────────────────────────── */

function ThreeViewProjection({ view }: { view: SkillView }) {
  const current = SEGMENTS.find((s) => s.current) ?? SEGMENTS[0]!;
  const mountedSkills = current.slots.filter((s) => s.kind === "skill");
  return (
    <section className="flex flex-col gap-2" data-testid="skill-binding-projection">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-13 font-semibold">运行时投影 · 三视角首屏跟着换</h2>
        <NewScreenTag>「切环节时 skill 自动换」出自 Backlog，原型未直接呈现</NewScreenTag>
      </div>
      <p className="text-10 text-muted-foreground">
        组长切换环节状态后，引导师/组长/组员三种视角首屏在 1 秒内跟着换；
        当前环节 <strong className="text-foreground">{current.index} {current.name}</strong> 挂载的 skill 显示「因环节 {current.index} 载入」。
      </p>
      <Card>
        <CardContent className="flex flex-col gap-2 pt-4">
          <div className="flex items-center gap-1.5 text-11 font-medium">
            <PanelLeft aria-hidden className="h-3.5 w-3.5" /> 画布屏左栏 · 本环节绑定的 skill
            {view === "member" && <Badge tone="outline">组员：只读 + 触发入口</Badge>}
          </div>
          {mountedSkills.map((s) => (
            <div key={s.name} className="flex items-center justify-between rounded-md border border-border-subtle bg-panel px-2 py-1.5 text-11" data-testid="skill-canvas-mounted">
              <span>{s.name} <span className="text-9 text-muted-foreground">因环节 {current.index} 载入</span></span>
              <Button size="xs" variant={view === "member" ? "outline" : "primary"} data-testid="skill-canvas-run">
                {view === "member" ? "运行（不可增删改）" : "运行"}
              </Button>
            </div>
          ))}
          <p className="text-9 text-muted-foreground">
            左栏清单与当前环节绑定表完全一致（AC5）；对组员只读，有触发入口无增删改。
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

/* ── [另存为组织模板]：主持人确认（O-03）───────────────────────────── */

function SaveAsDialog({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell testid="skill-saveas-dialog" title="另存为组织模板" onClose={onClose}>
      <p className="text-11 text-muted-foreground">
        将以<strong className="text-foreground">当前项目实例编排</strong>新建一个组织级工作流模板。<strong className="text-foreground">不回写原模板本体。</strong>
      </p>
      <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-10 text-muted-foreground">
        协同引导师 = 引导师多实例（O-03）。切模板 / 另存为组织模板涉及「最终确认」，
        <strong className="text-foreground">须由主持人确认</strong>。当前非主持人时此动作转为「请求主持人确认」。
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={onClose} data-testid="skill-saveas-confirm">确认另存</Button>
        <Button size="sm" variant="ghost" onClick={onClose} data-testid="skill-saveas-cancel">取消</Button>
      </div>
    </ModalShell>
  );
}

/* ── [改用这个] / 增删环节：孤立绑定处置（AC6，不静默丢弃）─────────── */

function OrphanDialog({ templateName, onClose }: { templateName: string; onClose: () => void }) {
  const orphans = [
    { seg: "03 假设风暴 · hmw", binding: "MECE 假设拆解 v4 · 语音转便签 v3" },
    { seg: "05 收敛投票", binding: "Scout 简报 v3" },
  ];
  return (
    <ModalShell testid="skill-orphan-dialog" title={`改用「${templateName}」将替换整张环节表`} onClose={onClose} danger>
      <p className="text-11 text-muted-foreground">
        切换会替换整张环节链，以下<strong className="text-foreground">实例级绑定与分工将失去宿主</strong>。确认前不执行，没有绑定条目被静默丢弃（AC6）。
      </p>
      <ul className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-2" data-testid="skill-orphan-list">
        {orphans.map((o) => (
          <li key={o.seg} className="text-10 text-destructive">· {o.seg} → {o.binding}</li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="destructive" onClick={onClose} data-testid="skill-orphan-confirm">我已了解，切换并丢弃上述绑定</Button>
        <Button size="sm" variant="ghost" onClick={onClose} data-testid="skill-orphan-cancel">取消</Button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  testid, title, onClose, children, danger,
}: {
  testid: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm" data-testid={testid} onClick={onClose}>
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="flex items-center gap-1.5 text-13 font-semibold">
          {danger && <AlertTriangle aria-hidden className="h-4 w-4 text-destructive" />}
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}
