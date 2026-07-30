import { FileText, FilePlus2, Wand2, Link2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StateShell, type UiState } from "@/components/state/state-shell";
import {
  INTERVIEW_TEMPLATES,
  TEMPLATE_LIBRARY_HEADER,
  TEMPLATE_SOURCE_LABEL,
  reportTemplateById,
  type ItvView,
} from "@/lib/mock/itv";
import { navHref } from "./nav-href";

/**
 * ① 访谈模板库（UC-6.1）—— 链路的起点，也是 v1 完全缺失的一层。
 *
 * 每行五要素：名称 ｜ 用过 N 次 ｜ 一句话说明 ｜ 题数 ｜ 时长区间。
 * v2 新增列：**配套报告模板** —— 人类原话「针对访谈模板还可以定义报告模板」。
 *   已绑定 → 显示报告模板名 + [看报告模板]；未绑定 → 显式「未定义报告模板」+ [定义报告模板]。
 * 数据字段（第三样，v1 也漏了）在行内以 Badge 列出，注明「→ 证据矩阵列」。
 */
export function TemplateLibrary({ state, view }: { state: UiState; view: ItvView }) {
  const h = TEMPLATE_LIBRARY_HEADER;
  return (
    <section className="flex flex-col gap-4 p-5" data-testid="itv-template-library">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-20 font-semibold text-foreground">
            访谈模板 · {h.count}
          </h1>
          <p className="text-12 text-muted-foreground">{h.blurb}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" data-testid="itv-template-new" disabled={view !== "researcher"}>
            <FilePlus2 aria-hidden className="h-3.5 w-3.5" />＋ 新建模板
          </Button>
          <Button asChild size="sm" variant="primary" data-testid="itv-template-new-interview">
            <a href={navHref({ screen: "new", view, state: "default" })}>＋ 新建访谈</a>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {h.tagFilters.map((t, i) => (
          <Button key={t} size="xs" variant={i === 0 ? "secondary" : "ghost"} data-testid={`itv-tpl-filter-${i}`}>
            {t}
          </Button>
        ))}
        <Badge tone="outline" className="ml-1">
          {h.sourceHint}
        </Badge>
      </div>

      <StateShell
        state={state}
        skeletonRows={5}
        emptyHint="模板库为空 —— 新建模板，或从已有访谈抽取一个"
        errors={{ name: "模板名称必填", fields: "至少定义一个要收集的数据字段" }}
        depFailure={{ what: "访谈 AI Skill（推演分段/字段）暂不可用，仍可手工建模板" }}
        denial={{ layer: "organization", reason: "你所在组织未开通访谈模板库" }}
        successMessage="模板已保存为新版本"
      >
        <div className="flex flex-col gap-3">
          {INTERVIEW_TEMPLATES.map((t) => {
            const rt = reportTemplateById(t.reportTemplateId);
            return (
              <Card key={t.id} data-testid={`itv-template-${t.id}`} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText aria-hidden className="h-4 w-4 text-muted-foreground" />
                      <span className="text-14 font-medium text-foreground">{t.name}</span>
                      <Badge tone="primary" data-testid={`itv-template-usedcount-${t.id}`}>
                        用过 {t.usedCount} 次
                      </Badge>
                      <Badge
                        tone={t.source === "extracted" ? "ai" : "neutral"}
                        data-testid={`itv-template-source-${t.id}`}
                      >
                        {TEMPLATE_SOURCE_LABEL[t.source]}
                      </Badge>
                      {t.tags.map((tag) => (
                        <Badge key={tag} tone="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-12 text-muted-foreground">
                      {t.blurb} · {t.questionCount} 题 · {t.durationRange}
                    </p>

                    {/* 第三样：要收集的数据字段（→ 证据矩阵列） */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-10 text-muted-foreground">要收集的数据字段 →</span>
                      {t.dataFields.map((f) => (
                        <Badge key={f.key} tone="neutral" data-testid={`itv-template-field-${t.id}-${f.key}`}>
                          {f.label}
                          {f.becomesMatrixColumn && <span className="text-muted-foreground"> · 矩阵列</span>}
                        </Badge>
                      ))}
                    </div>

                    {t.extractedFrom && (
                      <p className="text-10 text-ai-tint-foreground" data-testid={`itv-template-extract-${t.id}`}>
                        溯源：从 {t.extractedFrom.join(" / ")} 抽取（草案需研究员确认才入库）
                      </p>
                    )}

                    {/* v2 新增：配套报告模板 */}
                    {rt ? (
                      <div
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-panel px-2 py-1.5"
                        data-testid={`itv-template-report-${t.id}`}
                      >
                        <Link2 aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-11 text-foreground">配套报告模板：{rt.name}</span>
                        <Badge tone="outline">{rt.chapters.length} 章</Badge>
                        <Button asChild size="xs" variant="ghost" data-testid={`itv-template-report-open-${t.id}`}>
                          <a href={navHref({ screen: "template-editor", view, state: "default" })}>看报告模板</a>
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-warning/40 bg-warning/5 px-2 py-1.5"
                        data-testid={`itv-template-report-missing-${t.id}`}
                      >
                        <AlertCircle aria-hidden className="h-3.5 w-3.5 text-warning" />
                        <span className="text-11 text-foreground">未定义报告模板 —— 访谈结束后无法一键出洞察报告</span>
                        <Button asChild size="xs" variant="outline" data-testid={`itv-template-report-define-${t.id}`}>
                          <a href={navHref({ screen: "template-editor", view, state: "default" })}>定义报告模板</a>
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button asChild size="sm" variant="outline" data-testid={`itv-template-edit-${t.id}`}>
                      <a href={navHref({ screen: "template-editor", view, state: "default" })}>编辑</a>
                    </Button>
                    <Button asChild size="sm" variant="primary" data-testid={`itv-template-use-${t.id}`}>
                      <a href={navHref({ screen: "new", view, state: "default" })}>
                        <Wand2 aria-hidden className="h-3.5 w-3.5" />用它新建
                      </a>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </StateShell>
    </section>
  );
}
