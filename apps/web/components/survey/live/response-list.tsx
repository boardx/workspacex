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
  const [exclusionReason, setExclusionReason] = React.useState("");
  const excluded = responses.filter((r) => r.analysis === "excluded").length;
  const filtered = responses.filter(
    (r) =>
      (quality === "all" || r.quality === quality) &&
      (r.id.includes(query) || (r.submitter ?? "").includes(query)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const actualPage = Math.min(page, pages - 1);
  const item = responses.find((r) => r.id === selected);
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap gap-4">
        <p className="text-18 font-semibold">{responses.length} 份答卷</p>
        <p className="text-12 text-muted-foreground">
          有效 {responses.filter((r) => r.quality === "normal").length} · 待复核{" "}
          {responses.filter((r) => r.quality === "review").length} · 已排除分析 {excluded}
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="搜索答卷"
          placeholder="搜索答卷编号"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="质量筛选"
          className="rounded-md border border-border bg-card p-2 text-12"
          value={quality}
          onChange={(e) => {
            setQuality(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">全部答卷</option>
          <option value="normal">有效答卷</option>
          <option value="review">待复核</option>
        </select>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-left text-12">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3">编号</th>
              <th>提交时间</th>
              <th>用时</th>
              <th>质量</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(actualPage * 10, actualPage * 10 + 10).map((r) => (
              <tr key={r.id} className="border-b border-border">
                <td className="p-3">{r.id.slice(0, 12)}</td>
                <td>{new Date(r.submittedAt).toLocaleString("zh-CN")}</td>
                <td>{r.durationSeconds} 秒</td>
                <td>{r.quality === "normal" ? "有效" : "待复核"}</td>
                <td>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setSelected(r.id)}
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
      <div className="flex items-center justify-end gap-3">
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
      {item && (
        <section
          aria-label="答卷详情"
          className="rounded-lg border border-border bg-card p-5"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="text-16 font-semibold">完整答卷</h2>
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
              <Button variant="ghost" onClick={() => setSelected(null)}>
                收起详情
              </Button>
            </div>
          </div>
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
    </div>
  );
}
