"use client";
import { useI18n } from "@/lib/i18n/provider";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";

function batchResponses(runtime: SurveyRuntime, batchId?: string) {
  if (!batchId) return runtime.responses;
  const onlyBatch = (runtime.collectionBatches?.length ?? 0) <= 1;
  return runtime.responses.filter((response) =>
    response.collectionBatchId === batchId ||
    (onlyBatch && response.collectionBatchId === undefined),
  );
}

export function CollectionOverview({ runtime, batchId }: { runtime: SurveyRuntime; batchId?: string }) {
  const { t } = useI18n();
  const publication = runtime.publication;
  if (!publication) return null;
  const responses = batchResponses(runtime, batchId);
  const valid = responses.filter((response) => response.quality === "normal" && response.analysis !== "excluded");
  const average = responses.length
    ? Math.round(responses.reduce((total, response) => total + response.durationSeconds, 0) / responses.length)
    : null;
  return <div className="space-y-5">
    <section aria-label={t("survey.workspace.collectionData")} className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-16 font-semibold">{t("survey.workspace.collectionData")}</h2>
      <div className="mt-5 grid grid-cols-3 gap-3 divide-x divide-border text-center">
        <div><p className="text-24 font-semibold">{responses.length}</p><p className="mt-2 text-12 text-muted-foreground">{t("survey.workspace.received")}</p></div>
        <div><p className="text-24 font-semibold">{valid.length}</p><p className="mt-2 text-12 text-muted-foreground">{t("survey.workspace.validResponses")}</p></div>
        <div><p className="text-24 font-semibold">{average === null ? "—" : t("survey.workspace.duration", { minutes: Math.floor(average / 60), seconds: average % 60 })}</p><p className="mt-2 text-12 text-muted-foreground">{t("survey.workspace.averageTime")}</p></div>
      </div>
    </section>
  </div>;
}

export function RecentCollectionActivity({ runtime, batchId }: { runtime: SurveyRuntime; batchId?: string }) {
  const { t, locale } = useI18n();
  const responses = batchResponses(runtime, batchId);
  return <section aria-label={t("survey.workspace.recentActivity")} className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-16 font-semibold">{t("survey.workspace.recentActivity")}</h2>
      {responses.length === 0 ? <p className="mt-3 text-13 text-muted-foreground">{t("survey.workspace.noResponses")}</p> : <ul className="mt-3 divide-y divide-border">
        {[...responses].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)).slice(0, 5).map((response) => <li key={response.id} className="flex flex-wrap justify-between gap-2 py-3 text-13">
          <span>{t("survey.workspace.responseSubmitted", { id: response.id })}</span>
          <time dateTime={response.submittedAt} className="text-muted-foreground">{new Date(response.submittedAt).toLocaleString(locale)}</time>
        </li>)}
      </ul>}
    </section>;
}
