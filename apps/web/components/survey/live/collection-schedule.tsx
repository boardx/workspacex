"use client";
import { surveyRuntimeMessages } from "@/lib/survey/runtime-error-copy";
import { useI18n } from "@/lib/i18n/provider";
import { SURVEY_COLLECTION_DEFAULT_DAYS } from "@repo/contracts/survey-collection-window";
import { SurveyPublishInputSchema } from "@repo/contracts/survey-runtime";
import { Input } from "@/components/ui/input";

export function collectionScheduleInput(starts: string, expires: string): { startsAt?: string; expiresAt?: string } {
  const start = starts ? new Date(starts) : null;
  const end = expires ? new Date(expires) : null;
  if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime()))) {
    throw new Error(surveyRuntimeMessages.invalidDates);
  }
  const schedule = { ...(start ? { startsAt: start.toISOString() } : {}), ...(end ? { expiresAt: end.toISOString() } : {}) };
  if (!SurveyPublishInputSchema.safeParse({ expectedVersion: 1, ...schedule }).success) {
    throw new Error(surveyRuntimeMessages.endAfterStart);
  }
  if (end && end.getTime() <= Date.now()) throw new Error(surveyRuntimeMessages.endFuture);
  return schedule;
}

export function CollectionScheduleFields({ starts, expires, onStartChange, onEndChange, disabled }: {
  starts: string; expires: string; onStartChange: (value: string) => void; onEndChange: (value: string) => void; disabled: boolean;
}) {
  const { t } = useI18n();
  return <fieldset disabled={disabled} aria-label={t("survey.workspace.schedule")} className="grid gap-3 sm:grid-cols-2">
    <label className="block text-12">{t("survey.workspace.startLabel")}<Input aria-label={t("survey.workspace.startTime")} type="datetime-local" value={starts} onChange={event => onStartChange(event.target.value)} />
    </label>
    <label className="block text-12">{t("survey.workspace.endLabel", { days: SURVEY_COLLECTION_DEFAULT_DAYS })}
      <Input aria-label={t("survey.workspace.endTime")} type="datetime-local" value={expires} onChange={event => onEndChange(event.target.value)} />
    </label>
  </fieldset>;
}
