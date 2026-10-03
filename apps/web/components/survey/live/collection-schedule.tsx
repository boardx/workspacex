"use client";
import { SURVEY_COLLECTION_DEFAULT_DAYS } from "@repo/contracts/survey-collection-window";
import { SurveyPublishInputSchema } from "@repo/contracts/survey-runtime";
import { Input } from "@/components/ui/input";

export function collectionScheduleInput(starts: string, expires: string): { startsAt?: string; expiresAt?: string } {
  const start = starts ? new Date(starts) : null;
  const end = expires ? new Date(expires) : null;
  if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime()))) {
    throw new Error("请选择有效的开始和截止时间。");
  }
  const schedule = { ...(start ? { startsAt: start.toISOString() } : {}), ...(end ? { expiresAt: end.toISOString() } : {}) };
  if (!SurveyPublishInputSchema.safeParse({ expectedVersion: 1, ...schedule }).success) {
    throw new Error("截止时间必须晚于开始时间。");
  }
  if (end && end.getTime() <= Date.now()) throw new Error("截止时间必须晚于当前时间。");
  return schedule;
}

export function CollectionScheduleFields({ starts, expires, onStartChange, onEndChange, disabled }: {
  starts: string; expires: string; onStartChange: (value: string) => void; onEndChange: (value: string) => void; disabled: boolean;
}) {
  return <fieldset disabled={disabled} aria-label="回收时间" className="grid gap-3 sm:grid-cols-2">
    <label className="block text-12">开始时间（留空则立即开始）
      <Input aria-label="开始时间" type="datetime-local" value={starts} onChange={event => onStartChange(event.target.value)} />
    </label>
    <label className="block text-12">截止时间（默认从开始起 {SURVEY_COLLECTION_DEFAULT_DAYS} 天）
      <Input aria-label="截止时间" type="datetime-local" value={expires} onChange={event => onEndChange(event.target.value)} />
    </label>
  </fieldset>;
}
