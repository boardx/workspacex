import type { SurveyRuntime } from "@repo/contracts/survey-runtime";

export function CollectionOverview({ runtime }: { runtime: SurveyRuntime }) {
  const publication = runtime.publication;
  if (!publication) return null;
  const included = runtime.responses.filter((response) => response.analysis !== "excluded");
  const average = runtime.responses.length
    ? Math.round(runtime.responses.reduce((total, response) => total + response.durationSeconds, 0) / runtime.responses.length)
    : null;
  return <div className="space-y-5">
    <section aria-label="回收数据" className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-16 font-semibold">回收数据</h2>
      <div className="mt-5 grid grid-cols-3 gap-3 divide-x divide-border text-center">
        <div><p className="text-24 font-semibold">{runtime.responses.length}</p><p className="mt-2 text-12 text-muted-foreground">已收到答卷</p></div>
        <div><p className="text-24 font-semibold">{included.length}</p><p className="mt-2 text-12 text-muted-foreground">纳入分析</p></div>
        <div><p className="text-24 font-semibold">{average === null ? "—" : `${Math.floor(average / 60)}分${average % 60}秒`}</p><p className="mt-2 text-12 text-muted-foreground">平均填写时长</p></div>
      </div>
    </section>
    <section aria-label="最近回收动态" className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-16 font-semibold">最近回收动态</h2>
      {runtime.responses.length === 0 ? <p className="mt-3 text-13 text-muted-foreground">暂无答卷。分享问卷链接后，真实提交会显示在这里。</p> : <ul className="mt-3 divide-y divide-border">
        {[...runtime.responses].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)).slice(0, 5).map((response) => <li key={response.id} className="flex flex-wrap justify-between gap-2 py-3 text-13">
          <span>答卷 {response.id} 已提交</span>
          <time dateTime={response.submittedAt} className="text-muted-foreground">{new Date(response.submittedAt).toLocaleString("zh-CN")}</time>
        </li>)}
      </ul>}
    </section>
  </div>;
}
