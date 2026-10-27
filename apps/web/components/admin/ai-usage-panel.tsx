"use client";
import * as React from "react";
import { CalendarDays, Layers3, Activity, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readAiUsage, readAiUsageCalls, type UsageQuery, type UsageSummary, type UsageCalls } from "@/lib/live-ai-usage";
import { AiUsageLedger } from "./ai-usage-ledger";
import { dateQuery, dateRange, formatTokens, nativeQuantity, recordedTotal, usageDateLabel, UNIT_LABELS, type DatePreset } from "./ai-usage-format";

const PRESETS: { value: DatePreset; label: string }[] = [{ value: "today", label: "今天" }, { value: "week", label: "近 7 天" }, { value: "month", label: "本月" }];
const modelKey = (item: { modelProvider: string; modelId: string }) => JSON.stringify([item.modelProvider, item.modelId]);

/** Same ledger, scope and snapshot for platform, organization and personal views. */
export function AiUsagePanel({ orgId, platform = false, selfUserId }: { orgId: string; platform?: boolean; selfUserId?: string }) {
  // Reset all report and identity presentation when scope changes, including embedded admin views.
  return <UsageReport key={JSON.stringify([orgId, platform, selfUserId])} orgId={orgId} platform={platform} selfUserId={selfUserId} />;
}
function UsageReport({ orgId, platform, selfUserId }: { orgId: string; platform: boolean; selfUserId?: string }) {
  const [initial] = React.useState(() => dateRange("week"));
  const [start, setStart] = React.useState(initial.start), [end, setEnd] = React.useState(initial.end);
  const [preset, setPreset] = React.useState<DatePreset | "custom">("week");
  const [query, setQuery] = React.useState<UsageQuery>(() => dateQuery(initial.start, initial.end));
  const [summary, setSummary] = React.useState<UsageSummary | null>(null);
  const [calls, setCalls] = React.useState<UsageCalls | null>(null);
  const [modelOptions, setModelOptions] = React.useState<UsageSummary["models"]>([]);
  const [cursor, setCursor] = React.useState<UsageCalls["nextCursor"]>(null);
  const [summaryError, setSummaryError] = React.useState(false), [callsError, setCallsError] = React.useState(false);
  const [dateError, setDateError] = React.useState(false), [reload, setReload] = React.useState(0);
  const [tab, setTab] = React.useState("calls");

  React.useEffect(() => {
    let active = true;
    setSummary(null); setCalls(null); setCursor(null); setSummaryError(false); setCallsError(false);
    void readAiUsage(orgId, platform, { ...query, userId: selfUserId }).then(out => {
      if (!active) return;
      setSummary(out);
      if (!query.modelId) setModelOptions(out.models);
    }).catch(() => { if (active) setSummaryError(true); });
    return () => { active = false; };
  }, [orgId, platform, query, selfUserId, reload]);
  React.useEffect(() => {
    if (!summary) return;
    let active = true;
    setCalls(null); setCallsError(false);
    void readAiUsageCalls(orgId, platform, {
      ...query, userId: selfUserId, asOf: summary.asOf,
      ...(cursor ? { cursorTime: cursor.occurredAt, cursorId: cursor.id } : {}),
    }).then(out => { if (active) setCalls(out); }).catch(() => { if (active) setCallsError(true); });
    return () => { active = false; };
  }, [orgId, platform, query, summary, cursor, selfUserId, reload]);

  function applyDates(range: { start: string; end: string }) {
    try {
      const window = dateQuery(range.start, range.end);
      setQuery({ ...window, modelProvider: query.modelProvider, modelId: query.modelId }); setCursor(null); setDateError(false);
    } catch { setDateError(true); }
  }
  function selectPreset(value: DatePreset) {
    const range = dateRange(value);
    setPreset(value); setStart(range.start); setEnd(range.end); applyDates(range);
  }
  function selectModel(value: string) {
    const model = modelOptions.find(item => modelKey(item) === value);
    setCursor(null);
    setQuery({ ...query, modelProvider: model?.modelProvider, modelId: model?.modelId });
  }
  const current = summary?.current;
  return <section aria-label="AI用量" data-testid="ai-usage-report" className="mt-6 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2" aria-label="日期范围">
        {PRESETS.map(item => <Button key={item.value} size="sm" variant={preset === item.value ? "secondary" : "ghost"} aria-pressed={preset === item.value} onClick={() => selectPreset(item.value)}>{item.label}</Button>)}
        <Button size="sm" variant={preset === "custom" ? "secondary" : "ghost"} aria-pressed={preset === "custom"} onClick={() => setPreset("custom")}><CalendarDays className="size-4" aria-hidden />自定义日期</Button>
      </div>
      <div className="flex items-center gap-2">
        <Select aria-label="筛选模型" data-testid="usage-model-filter" className="w-56" value={query.modelId ? modelKey({ modelProvider: query.modelProvider ?? "", modelId: query.modelId }) : "all"}
          options={[{ value: "all", label: "全部模型" }, ...modelOptions.map(item => ({ value: modelKey(item), label: `${item.modelId} · ${item.modelProvider}` }))]} onValueChange={selectModel} />
        <Button size="sm" variant="ghost" onClick={() => { const range = dateRange("week"); setStart(range.start); setEnd(range.end); setPreset("week"); setCursor(null); setDateError(false); setQuery(dateQuery(range.start, range.end)); }}>重置筛选</Button>
      </div>
    </div>
    {preset === "custom" && <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
      <label className="space-y-2 text-13">开始日期<Input type="date" value={start} onChange={event => setStart(event.target.value)} /></label>
      <label className="space-y-2 text-13">结束日期<Input type="date" value={end} onChange={event => setEnd(event.target.value)} /></label>
      <Button onClick={() => applyDates({ start, end })}>应用日期</Button>
      <p className="text-12 text-muted-foreground">包含结束当天，最多选择 366 天</p>
    </div>}
    {dateError && <p role="alert" className="text-13 text-destructive">请选择有效日期，结束日期不能早于开始日期，范围不能超过 366 天。</p>}
    <p className="text-12 text-muted-foreground">{`${usageDateLabel(query.start)} — ${usageDateLabel(new Date(Date.parse(query.end) - 1).toISOString())}`} · 北京时间</p>
    {summaryError && <div role="alert" className="rounded-lg border p-5"><p>用量加载失败，请稍后重试。</p><Button className="mt-3" variant="outline" onClick={() => setReload(value => value + 1)}>重新加载</Button></div>}
    {!summary && !summaryError && <div role="status" aria-label="正在加载用量" className="grid gap-4 sm:grid-cols-3">{[1, 2, 3].map(key => <Skeleton key={key} className="h-28 rounded-xl" />)}</div>}
    {summary && current && <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="调用次数" value={current.callCount.toLocaleString("zh-CN")} icon={<Activity className="size-4" aria-hidden />} note={current.failedCalls ? `${current.failedCalls} 次失败` : "所选日期内的已记录调用"} />
        <Metric label="已记录用量" value={recordedTotal(current)} testId="usage-total-tokens" icon={<Layers3 className="size-4" aria-hidden />} note={current.unknownCalls ? `${current.unknownCalls} 次调用未上报用量${current.nativeCalls ? "" : " · Token"}` : current.nativeCalls ? "图片、音频等消耗按各自单位统计" : "Token · 包含输入和输出"} />
        <Metric label="调用费用" value="见调用明细" icon={<Coins className="size-4" aria-hidden />} note="未提供费用的调用显示为暂无数据" />
      </div>
      <div className="rounded-lg bg-muted/40 px-4 py-3 text-12 leading-6 text-muted-foreground">
        仅展示已记录的调用。未上报用量不代表零消耗，费用以已提供的数据为准。
        {summary.unsettledDispatchIntents > 0 && <span> 另有 {summary.unsettledDispatchIntents} 次请求等待结算。</span>}
        {current.legacyCalls > 0 && <span> 包含 {current.legacyCalls} 次历史统计口径的调用。</span>}
        {summary.nativeUnits.map(unit => <span key={unit.unit} className="ml-2">{unit.reportedCalls > 0 && <span>{nativeQuantity({ unit: unit.unit, quantity: unit.reportedQuantity, source: "reported" })}（已上报） </span>}{unit.estimatedCalls > 0 && <span>{nativeQuantity({ unit: unit.unit, quantity: unit.estimatedQuantity, source: "estimated" })} </span>}{unit.unknownCalls > 0 && <span>{UNIT_LABELS[unit.unit]}：{unit.unknownCalls} 次调用未上报</span>}</span>)}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="用量视图"><TabsTrigger value="calls">调用明细</TabsTrigger><TabsTrigger value="models">按模型汇总</TabsTrigger></TabsList>
        <TabsContent value="calls" className="mt-4">
          <div className="overflow-x-auto rounded-xl border bg-card">
            {callsError && <div role="alert" className="p-6"><p>调用明细加载失败，请重试。</p><Button variant="outline" className="mt-3" onClick={() => setReload(value => value + 1)}>重新加载明细</Button></div>}
            {!calls && !callsError && <div role="status" aria-label="正在加载调用明细" className="space-y-3 p-6">{[1, 2, 3].map(key => <Skeleton key={key} className="h-12" />)}</div>}
            {calls && (calls.calls.length ? <AiUsageLedger orgId={orgId} selfUserId={selfUserId} calls={calls.calls} /> : <div className="space-y-2 px-6 py-12 text-center"><CalendarDays className="mx-auto size-6 text-muted-foreground" aria-hidden /><p className="font-medium">暂无调用记录</p><p className="text-13 text-muted-foreground">试试其他日期或模型；未记录的调用不会出现在这里。</p></div>)}
          </div>
          {calls && <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-12 text-muted-foreground">本页 {calls.calls.length} 条 · 按调用开始时间展示</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!cursor} onClick={() => setCursor(null)}>回到首页</Button><Button variant="outline" size="sm" disabled={!calls.nextCursor} onClick={() => setCursor(calls.nextCursor)}>下一页</Button></div></div>}
        </TabsContent>
        <TabsContent value="models" className="mt-4">
          <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>模型</TableHead><TableHead className="text-right">调用次数</TableHead><TableHead className="text-right">已记录 Token</TableHead><TableHead><span className="sr-only">查看明细</span></TableHead></TableRow></TableHeader><TableBody>
            {summary.models.map(item => <TableRow key={modelKey(item)}><TableCell><span className="font-medium">{item.modelId}</span><div className="mt-1 text-12 text-muted-foreground">{item.modelProvider}</div></TableCell><TableCell className="text-right tabular-nums">{item.callCount.toLocaleString("zh-CN")}</TableCell><TableCell className="text-right tabular-nums">{current.unknownCalls === current.callCount && current.callCount > 0 ? "未上报" : current.nativeCalls === current.callCount && current.callCount > 0 ? "Token 不适用" : item.totalTokens === "0" && item.callCount > 0 && (current.unknownCalls > 0 || current.nativeCalls > 0) ? "用量待确认" : formatTokens(item.totalTokens)}<div className="text-12 text-muted-foreground">{current.unknownCalls || current.nativeCalls ? "仅统计已记录 Token，用量可能不完整" : "Token"}</div></TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" aria-label={`查看 ${item.modelId} 的调用`} onClick={() => { selectModel(modelKey(item)); setTab("calls"); }}>查看调用</Button></TableCell></TableRow>)}
          </TableBody></Table>{!summary.models.length && <p className="p-8 text-center text-13 text-muted-foreground">所选日期内暂无模型调用</p>}</div>
          {summary.truncated.models && <p className="mt-3 text-12 text-muted-foreground">模型数量较多，仅显示部分模型，请缩短日期范围。</p>}
        </TabsContent>
      </Tabs>
    </>}
  </section>;
}
function Metric({ label, value, note, icon, testId }: { label: string; value: string; note: string; icon: React.ReactNode; testId?: string }) {
  return <div className="rounded-xl border bg-card p-5"><div className="flex items-center justify-between text-13 text-muted-foreground"><span>{label}</span>{icon}</div><p data-testid={testId} className="mt-3 text-24 font-semibold tracking-tight tabular-nums">{value}</p><p className="mt-2 text-12 text-muted-foreground">{note}</p></div>;
}

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden className={`motion-safe:animate-pulse rounded bg-muted ${className}`} />;
}
