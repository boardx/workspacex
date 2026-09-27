import type { SurveyRuntime } from "@repo/contracts/survey-runtime";

export function CollectionOverview({ runtime }: { runtime: SurveyRuntime }) {
  const publication = runtime.publication;
  if (!publication) return null;
  const included = runtime.responses.filter((response) => response.analysis !== "excluded");
  const average = runtime.responses.length
    ? Math.round(runtime.responses.reduce((total, response) => total + response.durationSeconds, 0) / runtime.responses.length)
    : null;
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <section aria-label="回收数据" className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-16 font-semibold">回收数据</h2>
      <div className="mt-5 grid grid-cols-3 gap-3 divide-x divide-border text-center">
        <div><p className="text-24 font-semibold">{runtime.responses.length}</p><p className="mt-2 text-12 text-muted-foreground">已收到答卷</p></div>
        <div><p className="text-24 font-semibold">{included.length}</p><p className="mt-2 text-12 text-muted-foreground">纳入分析</p></div>
        <div><p className="text-24 font-semibold">{average === null ? "—" : `${Math.floor(average / 60)}分${average % 60}秒`}</p><p className="mt-2 text-12 text-muted-foreground">平均填写时长</p></div>
      </div>
    </section>
    <section aria-label="回收设置" className="space-y-3 rounded-lg border border-border bg-card p-5">
      <h2 className="text-16 font-semibold">回收设置</h2>
      <p className="text-13">发布版本 v{publication.version}</p>
      <p className="text-13">截止时间：{new Date(publication.expiresAt).toLocaleString("zh-CN")}</p>
      <p className="text-13">匿名填写：{runtime.anonymity === "anonymous" ? "开启" : "关闭"}</p>
      <p className="text-12 text-muted-foreground">填写者使用冻结的发布版本；历史答卷不会被草稿编辑覆盖。</p>
    </section>
  </div>;
}
