"use client";
import { displaySurveyRuntimeError } from "@/lib/survey/display-runtime-error";
import { surveyRuntimeMessages } from "@/lib/survey/runtime-error-copy";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { formatSurveyAnswer, isSurveyPageElement } from "@repo/contracts/survey";
import type { survey } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { downloadSurveyAttachment } from "@/lib/survey/runtime-client";
import { SurveyAttachmentMetadataSchema } from "@repo/contracts/survey";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { surveyResponseMarkdown } from "@/lib/survey/response-markdown";
import { Input } from "@/components/ui/input";

export function filterSurveyResponses(
  responses: survey.SurveyResponse[],
  questionById: ReadonlyMap<string, survey.SurveyWorkflowQuestion>,
  searchTerm: string,
  quality: string,
) {
  return responses.filter(
    (response) =>
      (quality === "all" ||
        (quality === "excluded"
          ? response.analysis === "excluded"
          : response.quality === quality && response.analysis !== "excluded")) &&
      (!searchTerm ||
        response.id.toLocaleLowerCase().includes(searchTerm) ||
        (response.submitter ?? "").toLocaleLowerCase().includes(searchTerm) ||
        response.answers.some((answer) => {
          const question = questionById.get(answer.questionId);
          return Boolean(
            question &&
              formatSurveyAnswer(question, answer.value)
                .toLocaleLowerCase()
                .includes(searchTerm),
          );
        })),
  );
}

export function LiveResponseList({
  surveyId,
  responses,
  questions,
  onReview,
  onAnalysis,
  busy,
}: {
  surveyId?: string;
  responses: survey.SurveyResponse[];
  questions: survey.SurveyWorkflowQuestion[];
  onReview: (id: string, quality: "normal" | "review") => void;
  onAnalysis?: (id: string, analysis: "included" | "excluded", reason?: string) => void;
  busy: boolean;
}) {
  const { t, locale } = useI18n();
  const [downloadError, setDownloadError] = React.useState<{ responseId: string; error: Error | string } | null>(null);
  const [downloading, setDownloading] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [quality, setQuality] = React.useState("all");
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [exclusionReason, setExclusionReason] = React.useState("");
  const excluded = responses.filter((r) => r.analysis === "excluded").length;
  const normal = responses.filter((r) => r.quality === "normal" && r.analysis !== "excluded").length;
  const review = responses.filter((r) => r.quality === "review" && r.analysis !== "excluded").length;
  const searchTerm = query.trim().toLocaleLowerCase();
  const questionById = React.useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions],
  );
  const filtered = React.useMemo(
    () => filterSurveyResponses(responses, questionById, searchTerm, quality),
    [responses, questionById, searchTerm, quality],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const actualPage = Math.min(page, pages - 1);
  const visibleRows = filtered.slice(actualPage * 10, actualPage * 10 + 10);
  const exportRows = selectedIds.length ? responses.filter((response) => selectedIds.includes(response.id)) : filtered;
  const item = filtered.find((r) => r.id === selected);
  const selectedIndex = filtered.findIndex((r) => r.id === selected);
  const selectResponse = (id: string) => { setExclusionReason(""); setSelected(id); };
  const [exporting, setExporting] = React.useState(false);
  const exportMarkdown = async () => {
    setExporting(true); setDownloadError(null);
    try {
    const markdown = await surveyResponseMarkdown(exportRows, questions, (responseId, id) => {
      if (!surveyId) throw new Error(surveyRuntimeMessages.attachmentAccess);
      return surveyRequest(`/surveys/${encodeURIComponent(surveyId)}/responses/${encodeURIComponent(responseId)}/attachments/${encodeURIComponent(id)}/metadata`, {}, SurveyAttachmentMetadataSchema);
    });
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'survey-responses.md';
    document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (error) { setDownloadError({ responseId: "export", error: error instanceof Error ? error : surveyRuntimeMessages.attachmentFallback }); }
    finally { setExporting(false); }
  };
  return (
    <div data-testid="survey-response-review-layout" className="grid items-start gap-5 p-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section aria-label={t("survey.results.responseList")} className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap gap-4">
        {downloadError?.responseId === "export" && <p role="alert">{displaySurveyRuntimeError(downloadError.error,t,locale)}</p>}
        <p className="text-18 font-semibold">{t("survey.results.responseCount", { count: responses.length })}</p>
      </div>
      <div aria-label={t("survey.results.responseGroups")} className="flex flex-wrap gap-2">
        {([['all', t("survey.results.allCount", { count: responses.length })], ['normal', t("survey.results.validCount", { count: normal })], ['review', t("survey.results.reviewCount", { count: review })], ['excluded', t("survey.results.excludedCount", { count: excluded })]] as const).map(([value, label]) =>
          <Button key={value} size="sm" variant={quality === value ? 'primary' : 'outline'} aria-pressed={quality === value} onClick={() => { setQuality(value); setPage(0); }}>{label}</Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          aria-label={t("survey.results.searchResponses")}
          placeholder={t("survey.results.searchPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <Button variant="outline" disabled={busy || exporting || exportRows.length === 0} onClick={() => void exportMarkdown()}>{selectedIds.length ? t("survey.results.exportSelected") : t("survey.results.exportMarkdown")}</Button>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-left text-12">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3"><input type="checkbox" aria-label={t("survey.results.selectPage")} checked={visibleRows.length > 0 && visibleRows.every((response) => selectedIds.includes(response.id))}
                onChange={(event) => setSelectedIds((current) => event.target.checked
                  ? [...new Set([...current, ...visibleRows.map((response) => response.id)])]
                  : current.filter((id) => !visibleRows.some((response) => response.id === id)))} /></th>
              <th className="p-3">{t("survey.results.id")}</th>
              <th>{t("survey.results.submittedAt")}</th>
              <th>{t("survey.results.duration")}</th>
              <th>{t("survey.results.quality")}</th>
              <th>{t("survey.results.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.id} className={`border-b border-border ${selected === r.id ? 'bg-muted' : ''}`}>
                <td className="p-3"><input type="checkbox" aria-label={t("survey.results.selectResponse", { id: r.id })} checked={selectedIds.includes(r.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, r.id])] : current.filter((id) => id !== r.id))} /></td>
                <td className="p-3">{r.id.slice(0, 12)}</td>
                <td>{new Date(r.submittedAt).toLocaleString(locale)}</td>
                <td>{t("survey.results.seconds", { count: r.durationSeconds })}</td>
                <td>{r.analysis === "excluded" ? t("survey.results.excluded") : r.quality === "normal" ? t("survey.results.valid") : t("survey.results.review")}</td>
                <td>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => selectResponse(r.id)}
                  >{t("survey.results.viewResponse")}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <p className="py-12 text-center text-muted-foreground">{t("survey.results.noMatches")}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-12 text-muted-foreground">{t("survey.results.selectedCount", { count: selectedIds.length })}</p>
        <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={actualPage === 0}
          onClick={() => setPage(actualPage - 1)}
        >{t("survey.results.previousPage")}</Button>
        <span className="text-12">
          {actualPage + 1} / {pages}
        </span>
        <Button
          variant="outline"
          disabled={actualPage >= pages - 1}
          onClick={() => setPage(actualPage + 1)}
        >{t("survey.results.nextPage")}</Button>
        </div>
      </div>
      </section>
      {item && (
        <section
          aria-label={t("survey.results.responseDetails")}
          className="min-w-0 break-words rounded-lg border border-border bg-card p-5"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="text-16 font-semibold">{t("survey.results.responseDetails")}</h2>
            <div className="flex min-w-0 flex-wrap gap-2">
              <Button size="xs" variant="outline" aria-label={t("survey.results.previousResponse")} disabled={selectedIndex <= 0} onClick={() => selectResponse(filtered[selectedIndex - 1]!.id)}>{t("survey.results.previous")}</Button>
              <Button size="xs" variant="outline" aria-label={t("survey.results.nextResponse")} disabled={selectedIndex < 0 || selectedIndex >= filtered.length - 1} onClick={() => selectResponse(filtered[selectedIndex + 1]!.id)}>{t("survey.results.next")}</Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <div className="flex min-w-0 flex-wrap gap-2">
              <Button
                disabled={busy}
                variant="outline"
                onClick={() =>
                  onReview(
                    item.id,
                    item.quality === "normal" ? "review" : "normal",
                  )
                }
              >
                {item.quality === "normal" ? t("survey.results.markReview") : t("survey.results.confirmValid")}
              </Button>
              {onAnalysis && (item.analysis === "excluded" ? (
                <Button disabled={busy} variant="outline" onClick={() => onAnalysis(item.id, "included")}>{t("survey.results.includeAgain")}</Button>
              ) : (
                <Button disabled={busy || !exclusionReason.trim()} variant="outline" onClick={() => onAnalysis(item.id, "excluded", exclusionReason.trim())}>{t("survey.results.exclude")}</Button>
              ))}
              <Button variant="ghost" onClick={() => {
                setExclusionReason("");
                setSelected(null);
              }}>{t("survey.results.collapseDetails")}</Button>
            </div>
          </div>
          <p className="mt-3 text-12 text-muted-foreground">{t("survey.results.responseMeta", { id: item.id, date: new Date(item.submittedAt).toLocaleString(locale), seconds: item.durationSeconds })}</p>
          {item.analysis === "excluded" ? (
            <p className="mt-3 text-12 text-warning">{t("survey.results.reasonPrefix", { reason: item.exclusionReason ?? t("survey.results.notFilled") })}</p>
          ) : onAnalysis ? (
            <label className="mt-3 grid gap-1 text-12">{t("survey.results.reasonLabel")}<Input aria-label={t("survey.results.reasonInput")} value={exclusionReason} onChange={(event) => setExclusionReason(event.target.value)} placeholder={t("survey.results.reasonPlaceholder")} />
            </label>
          ) : null}
          {(item.analysisHistory?.length ?? 0) > 0 && (
            <section aria-label={t("survey.results.history")} className="mt-3 rounded-md bg-muted p-3 text-12">
              <h3 className="font-medium">{t("survey.results.history")}</h3>
              <ol className="mt-1 space-y-1 text-muted-foreground">
                {item.analysisHistory!.map((entry, index) => (
                  <li key={`${entry.changedAt}-${index}`}>
                    {entry.analysis === "excluded"
                      ? t("survey.results.excludedHistory", { reason: entry.reason ?? "" })
                      : t("survey.results.includedHistory")}
                    {" · "}
                    {entry.actor}
                    {" · "}
                    {new Date(entry.changedAt).toLocaleString(locale)}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {downloadError?.responseId === item.id && <p role="alert" className="mt-3 text-12 text-destructive">{displaySurveyRuntimeError(downloadError.error, t, locale)}</p>}
          <ol className="mt-4 space-y-4">
            {questions.filter(q => !isSurveyPageElement(q)).map((q, i) => {
              const answer = item.answers.find((a) => a.questionId === q.id);
              return (
                <li key={q.id}>
                  <p className="text-12 font-medium">
                    {i + 1}. {q.title}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-12 text-muted-foreground">
                    {answer ? formatSurveyAnswer(q, answer.value) : t("survey.results.notFilled")}
                  </p>
                  {(q.type === "file" || q.type === "signature") && Array.isArray(answer?.value) && answer.value.map((id, index) => (
                    <Button key={id} size="xs" variant="outline" className="mr-2 mt-2" disabled={!surveyId || downloading !== null}
                      onClick={async () => {
                        if (!surveyId) return;
                        setDownloadError(null); setDownloading(id);
                        try { await downloadSurveyAttachment(surveyId, item.id, id); }
                        catch (error) { setDownloadError({ responseId: item.id, error: error instanceof Error ? error : surveyRuntimeMessages.attachmentFallback }); }
                        finally { setDownloading(null); }
                      }}>
                      {downloading === id ? t("survey.results.downloading") : q.type === "signature" ? t("survey.results.downloadSignature") : t("survey.results.downloadAttachment", { index: index + 1 })}
                    </Button>
                  ))}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {!item && <section aria-label={t("survey.results.responseDetails")} className="rounded-lg border border-border bg-card p-8 text-13 text-muted-foreground">{t("survey.results.selectResponseHelp")}</section>}
    </div>
  );
}
