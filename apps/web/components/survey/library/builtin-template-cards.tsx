"use client";
import { Badge } from "@/components/ui/badge";
import { ResourceCard } from "@/components/ui/resource-card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { BuiltinSurveyTemplate } from "@/lib/survey/builtin-templates";

export function BuiltinTemplateCards({
  items,
  base,
  busy,
  onCopy,
  onCreate,
}: {
  items: BuiltinSurveyTemplate[];
  base: string;
  busy: boolean;
  onCopy: (item: BuiltinSurveyTemplate) => void;
  onCreate: (item: BuiltinSurveyTemplate) => void;
}) {
  return (
    <section aria-label="内置模板" className="space-y-4">
      <div>
        <h2 className="text-16 font-semibold">内置模板</h2>
        <p className="mt-1 text-12 text-muted-foreground">
          可直接使用；修改后保存到我的模板，保留原始模板。
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <ResourceCard
            key={item.id}
            title={item.title}
            subtitle={`${item.questions.length} 道题目 · ${item.template.sections.length} 个报告章节`}
            badges={
              <Badge tone="primary">
                {item.kind === "report"
                  ? "报告模板"
                  : item.id.startsWith("builtin-survey-")
                    ? "完整问卷"
                    : "题目模块"}
              </Badge>
            }
            description={item.description}
            actions={
              <>
                <Button asChild size="sm" variant="outline">
                  <Link href={`${base}/${encodeURIComponent(item.id)}`}>查看并编辑</Link>
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onCopy(item)}>
                  保存到我的模板
                </Button>
                {item.kind === "question" && (
                  <Button size="sm" disabled={busy} onClick={() => onCreate(item)}>
                    使用并创建问卷
                  </Button>
                )}
              </>
            }
          />
        ))}
      </div>
      {!items.length && (
        <p className="text-13 text-muted-foreground">没有匹配的内置模板。</p>
      )}
    </section>
  );
}
