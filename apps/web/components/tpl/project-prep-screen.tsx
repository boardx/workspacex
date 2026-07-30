"use client";
import * as React from "react";
import { Sparkles, Plus, Minus, UserPlus, Repeat, ArrowRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import type { ProjectRole } from "@/lib/identity";
import { cn } from "@/lib/utils";
import {
  PROJECT_TOPIC, PROJECT_GROUPS, UNGROUPED, INTERVIEW_SUBJECTS,
  GROUP_STATUS_LABEL, GROUP_STATUS_TONE, type ProjectGroup,
} from "@/lib/mock/tpl";
import { AiTag, SignoffFlag } from "./parts";

const PREP_TABS = [
  { key: "topic", label: "定题与分组", signable: true },
  { key: "agenda", label: "议程 7 环节", signable: false },
  { key: "materials", label: "材料准备 9 份", signable: false },
  { key: "pretasks", label: "会前任务 7/12", signable: false },
];

export function ProjectPrepScreen({
  uiState, previewRole, onToast,
}: { uiState: UiState; previewRole: ProjectRole | null; onToast: (m: string) => void }) {
  const [groupCount, setGroupCount] = React.useState(PROJECT_GROUPS.length);
  const canWrite = previewRole === "facilitator" || previewRole === "groupLead";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4" data-testid="tpl-prep">
      <header className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <h1 className="text-20 font-bold tracking-tight">项目筹备</h1>
          <Badge tone="primary">蓝本 HMW 定题项目 v4</Badge>
        </div>
        <p className="text-12 text-muted-foreground">套用后引导师只改内容、不搭结构。</p>
      </header>

      <Tabs defaultValue="topic">
        <TabsList data-testid="tpl-prep-tabs">
          {PREP_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} data-testid="tpl-prep-tab">{t.label}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="topic">
          <StateShell
            state={uiState}
            skeletonRows={6}
            emptyHint="只选了蓝本、主题与分组还没定 —— 低准备度状态。可分次推进：先定主题，或先分组。"
            errors={{ "topic": "主题超过建议 30 字上限，且未标『判断口径』；分组第 3 组无组长，无法保存并同步到全场。" }}
            depFailure={{ what: "洞察库（09-kg）暂不可用：AI 生成主题/背景与「按背景均衡分组」已置灰，可手动填写。" }}
            denial={{ layer: "project", reason: "观察者只读，看不到筹备页的写操作按钮；组员只能看本组，不能改定题与全局分组。" }}
            successMessage="已保存并同步到全场：分组、议程与所有 AI 上下文都读到同一份主题"
          >
            <div className="flex flex-col gap-4">
              <TopicSection canWrite={canWrite} onToast={onToast} />
              <GroupingSection groupCount={groupCount} setGroupCount={setGroupCount} canWrite={canWrite} onToast={onToast} />
            </div>
          </StateShell>
        </TabsContent>

        {PREP_TABS.filter((t) => !t.signable).map((t) => (
          <TabsContent key={t.key} value={t.key}>
            <SignoffFlag kind="unexplored" title={`「${t.label}」子标签打开后的编辑器 —— 二级 sign-off`}>
              尚未探明，不等于原型没做。本域只落四子标签外壳与计数；「{t.label}」打开后的编辑器在原型中未点开，补抽取前不自行设计其内部交互。这里只放占位。
            </SignoffFlag>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/* ── 定题（单点继承）─────────────────────────────────────────────────── */

function TopicSection({ canWrite, onToast }: { canWrite: boolean; onToast: (m: string) => void }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-topic-section">
      <p className="rounded-md bg-panel px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="tpl-topic-rule">
        整场只有一个主题、一段背景；分组、议程与所有 AI 上下文都从这里继承。
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-topic">主题 · 一句话（建议 30 字内，带时间与判断口径）</Label>
        <Input id="tpl-topic" defaultValue={PROJECT_TOPIC.topic} disabled={!canWrite} data-testid="tpl-topic-input" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tpl-bg">背景 · 为什么现在开这场</Label>
        <Textarea id="tpl-bg" rows={3} defaultValue={PROJECT_TOPIC.background} disabled={!canWrite} data-testid="tpl-bg-input" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="ai" disabled={!canWrite} onClick={() => onToast("AI 生成主题（机器产出 · 需人确认）")} data-testid="tpl-ai-topic"><Sparkles aria-hidden className="h-3 w-3" /> AI 生成主题</Button>
        <Button size="xs" variant="ai" disabled={!canWrite} onClick={() => onToast("AI 生成背景（机器产出 · 需人确认）")} data-testid="tpl-ai-bg"><Sparkles aria-hidden className="h-3 w-3" /> AI 生成背景</Button>
        <Button size="xs" variant="ai" disabled={!canWrite} onClick={() => onToast("按洞察重写（机器产出 · 需人确认）")} data-testid="tpl-ai-rewrite"><Sparkles aria-hidden className="h-3 w-3" /> 按洞察重写</Button>
      </div>
      <AiTag sources={PROJECT_TOPIC.sources} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={!canWrite} onClick={() => onToast("已保存并同步到全场：分组、议程、各 AI 上下文取到同一份定题")} data-testid="tpl-topic-save">
          <Save aria-hidden className="h-3.5 w-3.5" /> 保存并同步到全场
        </Button>
        <span className="text-10 text-muted-foreground">保存即向下游同步，不是「只存这一页」。</span>
      </div>
    </section>
  );
}

/* ── 分组编排 ─────────────────────────────────────────────────────────── */

function GroupingSection({
  groupCount, setGroupCount, canWrite, onToast,
}: { groupCount: number; setGroupCount: (n: number) => void; canWrite: boolean; onToast: (m: string) => void }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-4" data-testid="tpl-grouping-section">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-13 font-semibold">分组编排</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-11 text-muted-foreground">分几组</span>
          <div className="flex items-center rounded-md border border-border">
            <Button size="icon" variant="ghost" aria-label="减少一组" disabled={!canWrite} onClick={() => setGroupCount(Math.max(1, groupCount - 1))} data-testid="tpl-group-minus"><Minus aria-hidden className="h-3 w-3" /></Button>
            <span className="w-6 text-center text-12" data-testid="tpl-group-count">{groupCount}</span>
            <Button size="icon" variant="ghost" aria-label="增加一组" disabled={!canWrite} onClick={() => setGroupCount(groupCount + 1)} data-testid="tpl-group-plus"><Plus aria-hidden className="h-3 w-3" /></Button>
          </div>
          <Button size="xs" variant="ai" disabled={!canWrite} onClick={() => onToast("AI 按背景均衡分组（建议 · 需人确认）")} data-testid="tpl-ai-balance"><Sparkles aria-hidden className="h-3 w-3" /> AI 按背景均衡分组</Button>
          <Button size="xs" variant="outline" disabled={!canWrite} onClick={() => setGroupCount(groupCount + 1)} data-testid="tpl-group-add"><Plus aria-hidden className="h-3 w-3" /> 加一组</Button>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {PROJECT_GROUPS.slice(0, groupCount).map((g) => <GroupRow key={g.ordinal} g={g} canWrite={canWrite} onToast={onToast} />)}
      </ul>

      <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-2" data-testid="tpl-ungrouped">
        <span className="text-11 text-muted-foreground">未分组 {UNGROUPED.length} 人：{UNGROUPED.join("、")}</span>
        <Button size="xs" variant="ai" className="ml-auto" disabled={!canWrite} onClick={() => onToast("AI 按背景分配（建议 · 需人确认）")} data-testid="tpl-ai-assign"><Sparkles aria-hidden className="h-3 w-3" /> AI 按背景分配</Button>
      </div>

      <p className="text-10 text-muted-foreground">主题、场景与分组会自动带入议程与现场协作；现场缺人再在「现场协作」里调。</p>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => onToast("跳到议程子标签")} data-testid="tpl-to-agenda">去议程 <ArrowRight aria-hidden className="h-3.5 w-3.5" /></Button>
      </div>

      <SubjectTable canWrite={canWrite} onToast={onToast} />
    </section>
  );
}

function GroupRow({ g, canWrite, onToast }: { g: ProjectGroup; canWrite: boolean; onToast: (m: string) => void }) {
  const [open, setOpen] = React.useState(g.ordinal === 2);
  return (
    <li className="rounded-md border border-border" data-testid="tpl-group-row">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 p-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="text-11 font-semibold text-muted-foreground">{g.ordinal}</span>
        <span className="text-12 font-medium">{g.name}</span>
        <Badge tone={GROUP_STATUS_TONE[g.status]} data-testid="tpl-group-status">{GROUP_STATUS_LABEL[g.status] === "缺 N 人" ? g.statusDetail : GROUP_STATUS_LABEL[g.status]}</Badge>
        <span className="truncate text-11 text-muted-foreground">{g.scenario}</span>
        <span className="ml-auto text-11 text-muted-foreground">{g.memberCount} 人 · 组长 {g.lead}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-border p-2.5">
          <p className="text-11"><span className="text-muted-foreground">场景 · 本组要推演什么：</span>{g.scenario}</p>
          <div className="flex items-center gap-1.5">
            <span className="text-11 text-muted-foreground">组员 {g.memberCount} 人</span>
            <Button size="xs" variant="outline" disabled={!canWrite} onClick={() => onToast(`向 ${g.name} 加人`)} data-testid="tpl-group-addmember"><UserPlus aria-hidden className="h-3 w-3" /> 加人</Button>
            <Button size="xs" variant="outline" disabled={!canWrite} onClick={() => onToast(`更换 ${g.name} 组长`)} data-testid="tpl-group-changelead"><Repeat aria-hidden className="h-3 w-3" /> 换组长</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ── 观察/访谈对象表 ──────────────────────────────────────────────────── */

const SUBJECT_COLS = ["对象", "部门角色", "联系方式", "背景与要问什么", "方式", "状态"];

function SubjectTable({ canWrite, onToast }: { canWrite: boolean; onToast: (m: string) => void }) {
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md border border-border p-3" data-testid="tpl-subject-table">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-12 font-semibold">观察 / 访谈对象表</span>
        <Button size="xs" variant="ai" className="ml-auto" disabled={!canWrite} onClick={() => onToast("AI 建议人选（机器产出 · 需人确认）")} data-testid="tpl-subject-ai"><Sparkles aria-hidden className="h-3 w-3" /> AI 建议人选</Button>
        <Button size="xs" variant="outline" disabled={!canWrite} onClick={() => onToast("加一个访谈对象")} data-testid="tpl-subject-add"><Plus aria-hidden className="h-3 w-3" /> 加对象</Button>
      </div>
      <div className="overflow-x-auto" data-allow-x-scroll="访谈对象表六列，窄屏允许横向滚动看全">
        <table className="w-full min-w-[640px] border-collapse text-11">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              {SUBJECT_COLS.map((c) => <th key={c} className="px-2 py-1 font-medium">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {INTERVIEW_SUBJECTS.map((s, i) => (
              <tr key={i} className="border-b border-border/60" data-testid="tpl-subject-row">
                <td className="px-2 py-1.5">{s.name}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{s.role}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{s.contact}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{s.focus}</td>
                <td className="px-2 py-1.5">{s.method}</td>
                <td className="px-2 py-1.5">
                  {s.status.includes("AI") ? <Badge tone="ai">{s.status}</Badge> : <Badge tone="outline">{s.status}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-10 text-muted-foreground">访谈 AI 会按这张表提前预约并生成提纲；现场访谈转写自动回流到本组。（预约 / 提纲 / 回流属 06-itv，本域只落结构与填写）</p>
    </div>
  );
}
