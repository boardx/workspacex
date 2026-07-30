import { GripVertical, Trash2, Plus, FileText, UserPen, Bot, AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StaticSwitch } from "./static-switch";
import { StateShell, type UiState } from "@/components/state/state-shell";
import {
  INTERVIEW_TEMPLATES,
  RESEARCH_DESIGN,
  reportTemplateById,
  CHAPTER_AUTHORING_LABEL,
  type ItvView,
} from "@/lib/mock/itv";

/**
 * ① 模板编辑器 · 报告模板（UC-6.1）—— v2 核心新增。
 *
 * 左：**访谈模板本体** = 提纲分段（名称/时长/顺序可拖）+ 要收集的数据字段。
 * 右：**配套报告模板** = 人类原话「针对访谈模板定义报告模板」。
 *     报告章节骨架写死、内容留空；每章「必须人写 / AI 起草」；每章映射一个数据来源，
 *     缺来源的章节标红（发布/生成被阻断）。这条链的终点（洞察报告）就靠它成型。
 * 危险动作：删除段落 / 删除章节 —— 二次确认 + 影响范围说明（写操作仅研究员）。
 */
export function TemplateEditor({ state, view }: { state: UiState; view: ItvView }) {
  const tpl = INTERVIEW_TEMPLATES.find((t) => t.id === "tpl-procure")!;
  const rt = reportTemplateById(tpl.reportTemplateId)!;
  const canWrite = view === "researcher";
  const missingChapters = rt.chapters.filter((c) => c.sourceState === "missing").length;

  return (
    <section className="flex flex-col gap-4 p-5" data-testid="itv-template-editor">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-20 font-semibold text-foreground">编辑模板 · {tpl.name}</h1>
          <Badge tone="primary">用过 {tpl.usedCount} 次</Badge>
        </div>
        <p className="text-12 text-muted-foreground">
          模板决定 ① 提纲结构 ② 每段时长 ③ 要收集的数据字段；编辑产生新版本，已建访谈不受影响（套用即脱钩）。
        </p>
      </header>

      <StateShell
        state={state}
        skeletonRows={6}
        emptyHint="这是新模板 —— 先填名称与访谈目标，助手会推演分段与字段"
        errors={{ segment: "第 03 段缺「要问出什么」", chapter: "第 7 章「产品机会」缺数据来源，发布会被阻断" }}
        depFailure={{ what: "访谈 AI Skill 暂不可用，可手工编辑分段与报告章节" }}
        denial={{ layer: "project", reason: "你不是本模板的所有者，无法编辑" }}
        successMessage="模板与报告模板已保存为新版本"
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {/* 左：访谈模板本体 —— 提纲 */}
          <div className="flex flex-col gap-3">
            <Card className="p-4" data-testid="itv-editor-outline">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-13 font-medium text-foreground">访谈提纲 · 合计 55 分</span>
                <Button size="xs" variant="outline" disabled={!canWrite} data-testid="itv-editor-add-segment">
                  <Plus aria-hidden className="h-3 w-3" />加一段
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {RESEARCH_DESIGN.segments.map((sg) => (
                  <div
                    key={sg.no}
                    data-testid={`itv-editor-segment-${sg.no}`}
                    className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel p-2.5"
                  >
                    <GripVertical aria-hidden className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-11 font-semibold text-foreground">{sg.no}</span>
                        <Badge tone="neutral">{sg.minutes} 分</Badge>
                        {sg.needsRewrite && <Badge tone="warning">需改问法</Badge>}
                      </div>
                      <p className="text-12 text-foreground">要问出什么：{sg.goal}</p>
                      <ul className="flex flex-col gap-0.5">
                        {sg.openers.map((q, i) => (
                          <li key={i} className="text-11 text-muted-foreground">「{q}」</li>
                        ))}
                      </ul>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={!canWrite}
                      aria-label={`删除段落 ${sg.no}`}
                      data-testid={`itv-editor-del-segment-${sg.no}`}
                      className="shrink-0"
                    >
                      <Trash2 aria-hidden className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4" data-testid="itv-editor-fields">
              <span className="text-13 font-medium text-foreground">要收集的数据字段</span>
              <p className="mb-2 text-10 text-muted-foreground">每个字段将成为洞察阶段证据矩阵的一列（UC-6.5）</p>
              <div className="flex flex-wrap gap-1.5">
                {tpl.dataFields.map((f) => (
                  <Badge key={f.key} tone="neutral" data-testid={`itv-editor-field-${f.key}`}>
                    {f.label} · 矩阵列
                  </Badge>
                ))}
                <Button size="xs" variant="ghost" disabled={!canWrite}>
                  <Plus aria-hidden className="h-3 w-3" />加字段
                </Button>
              </div>
            </Card>
          </div>

          {/* 右：配套报告模板定义 */}
          <div className="flex flex-col gap-3">
            <Card className="p-4" data-testid="itv-editor-report-template">
              <div className="mb-2 flex items-center gap-2">
                <FileText aria-hidden className="h-4 w-4 text-muted-foreground" />
                <span className="text-13 font-medium text-foreground">配套报告模板 · {rt.name}</span>
              </div>
              <p className="mb-3 rounded-md border border-border-subtle bg-panel px-2 py-1.5 text-11 text-muted-foreground">
                {rt.rule}
              </p>

              {/* 报告受众/目的/开关 */}
              <div className="mb-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-10 text-muted-foreground">受众：</span>
                  {rt.audienceOptions.map((a, i) => (
                    <Badge key={a} tone={i === 0 ? "primary" : "outline"}>{a}</Badge>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-10 text-muted-foreground">目的：</span>
                  {rt.purposeOptions.map((p, i) => (
                    <Badge key={p} tone={i === 0 ? "primary" : "outline"}>{p}</Badge>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {rt.toggles.map((tg) => (
                    <span key={tg.key} className="flex items-center gap-1.5 text-11 text-foreground">
                      <StaticSwitch on={tg.on} label={tg.label} testId={`itv-report-toggle-${tg.key}`} />
                      {tg.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* 报告章节（骨架写死，映射数据来源） */}
              <div className="flex items-center justify-between">
                <span className="text-12 font-medium text-foreground">报告章节 · {rt.chapters.length}</span>
                {missingChapters > 0 && (
                  <Badge tone="warning" data-testid="itv-report-missing-count">
                    {missingChapters} 章缺来源 · 发布被阻断
                  </Badge>
                )}
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {rt.chapters.map((c) => (
                  <div
                    key={c.no}
                    data-testid={`itv-report-chapter-${c.no}`}
                    className="flex items-start gap-2 rounded-md border border-border-subtle bg-panel p-2"
                  >
                    <span className="mt-0.5 text-11 font-semibold text-muted-foreground">{c.no}</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-12 text-foreground">{c.title}</span>
                        <Badge tone={c.authoring === "human" ? "outline" : "ai"}>
                          {c.authoring === "human" ? (
                            <UserPen aria-hidden className="h-3 w-3" />
                          ) : (
                            <Bot aria-hidden className="h-3 w-3" />
                          )}
                          {CHAPTER_AUTHORING_LABEL[c.authoring]}
                        </Badge>
                      </div>
                      <span
                        className={
                          c.sourceState === "missing"
                            ? "flex items-center gap-1 text-10 text-warning"
                            : "flex items-center gap-1 text-10 text-muted-foreground"
                        }
                        data-testid={`itv-report-chapter-source-${c.no}`}
                      >
                        {c.sourceState === "missing" ? (
                          <AlertCircle aria-hidden className="h-3 w-3" />
                        ) : (
                          <CheckCircle2 aria-hidden className="h-3 w-3" />
                        )}
                        {c.source}
                      </span>
                    </div>
                  </div>
                ))}
                <Button size="xs" variant="ghost" disabled={!canWrite} data-testid="itv-report-add-chapter">
                  <Plus aria-hidden className="h-3 w-3" />新增报告章节
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </StateShell>
    </section>
  );
}
