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
  const publication = runtime.publication;
  if (!publication) return null;
  const responses = batchResponses(runtime, batchId);
  const valid = responses.filter((response) => response.quality === "normal" && response.analysis !== "excluded");
  const average = responses.length
    ? Math.round(responses.reduce((total, response) => total + response.durationSeconds, 0) / responses.length)
    : null;
  return <div className="space-y-5">
    <section aria-label="回收数据" className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-16 font-semibold">回收数据</h2>
      <div className="mt-5 grid grid-cols-3 gap-3 divide-x divide-border text-center">
        <div><p className="text-24 font-semibold">{responses.length}</p><p className="mt-2 text-12 text-muted-foreground">已收到答卷</p></div>
        <div><p className="text-24 font-semibold">{valid.length}</p><p className="mt-2 text-12 text-muted-foreground">有效答卷</p></div>
        <div><p className="text-24 font-semibold">{average === null ? "—" : `${Math.floor(average / 60)}分${average % 60}秒`}</p><p className="mt-2 text-12 text-muted-foreground">平均填写时长</p></div>
      </div>
    </section>
  </div>;
}

export function RecentCollectionActivity({ runtime, batchId }: { runtime: SurveyRuntime; batchId?: string }) {
  const responses = batchResponses(runtime, batchId);
  return <section aria-label="最近回收动态" className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-16 font-semibold">最近回收动态</h2>
      {responses.length === 0 ? <p className="mt-3 text-13 text-muted-foreground">暂无答卷。分享问卷链接后，真实提交会显示在这里。</p> : <ul className="mt-3 divide-y divide-border">
        {[...responses].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)).slice(0, 5).map((response) => <li key={response.id} className="flex flex-wrap justify-between gap-2 py-3 text-13">
          <span>答卷 {response.id} 已提交</span>
          <time dateTime={response.submittedAt} className="text-muted-foreground">{new Date(response.submittedAt).toLocaleString("zh-CN")}</time>
        </li>)}
      </ul>}
    </section>;
}
