"use client";
import * as React from "react";
import { formatSurveyAnswer, isSurveyPageElement } from "@repo/contracts/survey";
import type { survey } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { downloadSurveyAttachment } from "@/lib/survey/runtime-client";
import { Input } from "@/components/ui/input";
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
  const [downloadError, setDownloadError] = React.useState("");
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
  const filtered = responses.filter(
    (r) =>
      (quality === "all" || (quality === "excluded" ? r.analysis === "excluded" : r.quality === quality && r.analysis !== "excluded")) &&
      (!searchTerm || r.id.toLocaleLowerCase().includes(searchTerm) || (r.submitter ?? "").toLocaleLowerCase().includes(searchTerm) ||
        r.answers.some((answer) => {
          const question = questions.find((item) => item.id === answer.questionId);
          return question && formatSurveyAnswer(question, answer.value).toLocaleLowerCase().includes(searchTerm);
        })),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const actualPage = Math.min(page, pages - 1);
  const visibleRows = filtered.slice(actualPage * 10, actualPage * 10 + 10);
  const exportRows = selectedIds.length ? responses.filter((response) => selectedIds.includes(response.id)) : filtered;
  const item = filtered.find((r) => r.id === selected);
  const selectedIndex = filtered.findIndex((r) => r.id === selected);
  const selectResponse = (id: string) => { setExclusionReason(""); setSelected(id); };
  const exportMarkdown = () => {
    const markdown = ['# 问卷答卷', ...exportRows.map((response) => [
      `## 答卷 ${response.id}`, `提交时间：${response.submittedAt}`, `用时：${response.durationSeconds} 秒`,
      `分析状态：${response.analysis === 'excluded' ? '已排除' : '纳入分析'}`, ...questions.filter(q => !isSurveyPageElement(q)).map(q => {
        const answer = response.answers.find(a => a.questionId === q.id);
        return `### ${q.title}\n\n${answer ? formatSurveyAnswer(q, answer.value) : '未填写'}`;
      }),
    ].join('\n\n'))].join('\n\n');
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'survey-responses.md';
    document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  };
  return (
    <div data-testid="survey-response-review-layout" className="grid items-start gap-5 p-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section aria-label="答卷列表" className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap gap-4">
        <p className="text-18 font-semibold">{responses.length} 份答卷</p>
      </div>
      <div aria-label="答卷分类" className="flex flex-wrap gap-2">
        {([['all', `全部 ${responses.length}`], ['normal', `有效 ${normal}`], ['review', `待复核 ${review}`], ['excluded', `已排除分析 ${excluded}`]] as const).map(([value, label]) =>
          <Button key={value} size="sm" variant={quality === value ? 'primary' : 'outline'} aria-pressed={quality === value} onClick={() => { setQuality(value); setPage(0); }}>{label}</Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          aria-label="搜索答卷"
          placeholder="搜索编号或回答关键词"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <Button variant="outline" disabled={busy || exportRows.length === 0} onClick={exportMarkdown}>{selectedIds.length ? "导出所选 Markdown" : "导出 Markdown"}</Button>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-left text-12">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3"><input type="checkbox" aria-label="选择本页答卷" checked={visibleRows.length > 0 && visibleRows.every((response) => selectedIds.includes(response.id))}
                onChange={(event) => setSelectedIds((current) => event.target.checked
                  ? [...new Set([...current, ...visibleRows.map((response) => response.id)])]
                  : current.filter((id) => !visibleRows.some((response) => response.id === id)))} /></th>
              <th className="p-3">编号</th>
              <th>提交时间</th>
              <th>用时</th>
              <th>质量</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => (
              <tr key={r.id} className={`border-b border-border ${selected === r.id ? 'bg-muted' : ''}`}>
                <td className="p-3"><input type="checkbox" aria-label={`选择答卷 ${r.id}`} checked={selectedIds.includes(r.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, r.id])] : current.filter((id) => id !== r.id))} /></td>
                <td className="p-3">{r.id.slice(0, 12)}</td>
                <td>{new Date(r.submittedAt).toLocaleString("zh-CN")}</td>
                <td>{r.durationSeconds} 秒</td>
                <td>{r.analysis === "excluded" ? "已排除分析" : r.quality === "normal" ? "有效" : "待复核"}</td>
                <td>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => selectResponse(r.id)}
                  >
                    查看完整答卷
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <p className="py-12 text-center text-muted-foreground">
          没有符合条件的答卷。
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-12 text-muted-foreground">已选择 {selectedIds.length} 项</p>
        <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={actualPage === 0}
          onClick={() => setPage(actualPage - 1)}
        >
          上一页
        </Button>
        <span className="text-12">
          {actualPage + 1} / {pages}
        </span>
        <Button
          variant="outline"
          disabled={actualPage >= pages - 1}
          onClick={() => setPage(actualPage + 1)}
        >
          下一页
        </Button>
        </div>
      </div>
      </section>
      {item && (
        <section
          aria-label="答卷详情"
          className="rounded-lg border border-border bg-card p-5"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="text-16 font-semibold">答卷详情</h2>
            <div className="flex gap-2">
              <Button size="xs" variant="outline" aria-label="上一条答卷" disabled={selectedIndex <= 0} onClick={() => selectResponse(filtered[selectedIndex - 1]!.id)}>上一条</Button>
              <Button size="xs" variant="outline" aria-label="下一条答卷" disabled={selectedIndex < 0 || selectedIndex >= filtered.length - 1} onClick={() => selectResponse(filtered[selectedIndex + 1]!.id)}>下一条</Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <div className="flex gap-2">
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
                {item.quality === "normal" ? "标记待复核" : "确认有效"}
              </Button>
              {onAnalysis && (item.analysis === "excluded" ? (
                <Button disabled={busy} variant="outline" onClick={() => onAnalysis(item.id, "included")}>
                  重新纳入分析
                </Button>
              ) : (
                <Button disabled={busy || !exclusionReason.trim()} variant="outline" onClick={() => onAnalysis(item.id, "excluded", exclusionReason.trim())}>
                  排除分析
                </Button>
              ))}
              <Button variant="ghost" onClick={() => {
                setExclusionReason("");
                setSelected(null);
              }}>
                收起详情
              </Button>
            </div>
          </div>
          <p className="mt-3 text-12 text-muted-foreground">{item.id} · {new Date(item.submittedAt).toLocaleString('zh-CN')} · 用时 {item.durationSeconds} 秒</p>
          {item.analysis === "excluded" ? (
            <p className="mt-3 text-12 text-warning">排除原因：{item.exclusionReason ?? "未填写"}</p>
          ) : onAnalysis ? (
            <label className="mt-3 grid gap-1 text-12">
              排除原因
              <Input aria-label="排除分析原因" value={exclusionReason} onChange={(event) => setExclusionReason(event.target.value)} placeholder="例如：测试性或重复提交" />
            </label>
          ) : null}
          {(item.analysisHistory?.length ?? 0) > 0 && (
            <section aria-label="分析治理记录" className="mt-3 rounded-md bg-muted p-3 text-12">
              <h3 className="font-medium">分析治理记录</h3>
              <ol className="mt-1 space-y-1 text-muted-foreground">
                {item.analysisHistory!.map((entry, index) => (
                  <li key={`${entry.changedAt}-${index}`}>
                    {entry.analysis === "excluded"
                      ? `已排除：${entry.reason}`
                      : "已重新纳入分析"}
                    {" · "}
                    {entry.actor}
                    {" · "}
                    {new Date(entry.changedAt).toLocaleString("zh-CN")}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {downloadError && <p role="alert" className="mt-3 text-12 text-destructive">{downloadError}</p>}
          <ol className="mt-4 space-y-4">
            {questions.filter(q => !isSurveyPageElement(q)).map((q, i) => {
              const answer = item.answers.find((a) => a.questionId === q.id);
              return (
                <li key={q.id}>
                  <p className="text-12 font-medium">
                    {i + 1}. {q.title}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-12 text-muted-foreground">
                    {answer ? formatSurveyAnswer(q, answer.value) : "未填写"}
                  </p>
                  {(q.type === "file" || q.type === "signature") && Array.isArray(answer?.value) && answer.value.map((id, index) => (
                    <Button key={id} size="xs" variant="outline" className="mr-2 mt-2" disabled={!surveyId || downloading !== null}
                      onClick={async () => {
                        if (!surveyId) return;
                        setDownloadError(""); setDownloading(id);
                        try { await downloadSurveyAttachment(surveyId, item.id, id); }
                        catch (error) { setDownloadError(error instanceof Error ? error.message : "附件下载失败，请重试。"); }
                        finally { setDownloading(null); }
                      }}>
                      {downloading === id ? "正在下载…" : q.type === "signature" ? "下载签名" : `下载附件 ${index + 1}`}
                    </Button>
                  ))}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {!item && <section aria-label="答卷详情" className="rounded-lg border border-border bg-card p-8 text-13 text-muted-foreground">选择一份答卷，查看真实回答和治理记录。</section>}
    </div>
  );
}
