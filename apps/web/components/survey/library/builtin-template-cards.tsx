"use client";
import { useI18n } from "@/lib/i18n/provider";
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
  const { t } = useI18n();
  return (
    <section aria-label={t("survey.templates.builtin")} className="space-y-4">
      <div>
        <h2 className="text-16 font-semibold">{t("survey.templates.builtin")}</h2>
        <p className="mt-1 text-12 text-muted-foreground">
          {t("survey.templates.builtinHint")}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <ResourceCard
            key={item.id}
            title={item.title}
            subtitle={t("survey.templates.counts", { questions: item.questions.length, sections: item.template.sections.length })}
            badges={
              <Badge tone="primary">
                {item.kind === "report"
                  ? t("survey.templates.reportOne")
                  : item.id.startsWith("builtin-survey-")
                    ? t("survey.templates.completeSurvey")
                    : t("survey.templates.module")}
              </Badge>
            }
            description={item.description}
            actions={
              <>
                <Button asChild size="sm" variant="outline">
                  <Link href={`${base}/${encodeURIComponent(item.id)}`}>{t("survey.templates.viewEdit")}</Link>
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onCopy(item)}>
                  {t("survey.templates.saveMine")}
                </Button>
                {item.kind === "question" && (
                  <Button size="sm" disabled={busy} onClick={() => onCreate(item)}>
                    {t("survey.templates.useCreate")}
                  </Button>
                )}
              </>
            }
          />
        ))}
      </div>
      {!items.length && (
        <p className="text-13 text-muted-foreground">{t("survey.templates.noBuiltin")}</p>
      )}
    </section>
  );
}
