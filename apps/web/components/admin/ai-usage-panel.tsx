"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { CalendarDays, Layers3, Activity, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readAiUsage, readAiUsageCalls, type UsageQuery, type UsageSummary, type UsageCalls } from "@/lib/live-ai-usage";
import { useOrgMemberNames, memberLabel } from "@/lib/use-org-member-names";
import { AiUsageLedger } from "./ai-usage-ledger";
import { dateQuery, dateRange, formatTokens, nativeQuantity, recordedTotal, usageDateLabel, creditLabel, nativeUnitLabel, type DatePreset } from "./ai-usage-format";

import { usageBucketEnd, usageMidnight, type UsageGrain } from "@/lib/ai-usage-chart";
import { AiUsageOverview } from "./ai-usage-overview";


const modelKey = (item: { modelProvider: string; modelId: string }) => JSON.stringify([item.modelProvider, item.modelId]);

/** Same ledger, scope and snapshot for platform, organization and personal views. */
export function AiUsagePanel({ orgId, platform = false, selfUserId }: { orgId: string; platform?: boolean; selfUserId?: string }) {
  // Reset all report and identity presentation when scope changes, including embedded admin views.
  return <UsageReport key={JSON.stringify([orgId, platform, selfUserId])} orgId={orgId} platform={platform} selfUserId={selfUserId} />;
}
function UsageReport({ orgId, platform, selfUserId }: { orgId: string; platform: boolean; selfUserId?: string }) {
  const { locale, t } = useI18n();
  const PRESETS: { value: DatePreset; label: string }[] = [{ value: "today", label: t("aiUsage.today") }, { value: "week", label: t("aiUsage.last7Days") }, { value: "month", label: t("aiUsage.thisMonth") }];
  const names = useOrgMemberNames(selfUserId ? null : orgId);
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
  const [tab, setTab] = React.useState("summary");

  React.useEffect(() => {
    let active = true;
    setSummary(null); setCalls(null); setCursor(null); setSummaryError(false); setCallsError(false);
    void readAiUsage(orgId, platform, { ...query, userId: selfUserId ?? query.userId }, ...(selfUserId ? [true] as const : [])).then(out => {
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
      ...query, userId: selfUserId ?? query.userId, asOf: summary.asOf,
      ...(cursor ? { cursorTime: cursor.occurredAt, cursorId: cursor.id } : {}),
    }, ...(selfUserId ? [true] as const : [])).then(out => { if (active) setCalls(out); }).catch(() => { if (active) setCallsError(true); });
    return () => { active = false; };
  }, [orgId, platform, query, summary, cursor, selfUserId, reload]);

  function applyDates(range: { start: string; end: string }) {
    try {
      const window = dateQuery(range.start, range.end);
      setQuery({ ...query, ...window, asOf: undefined, modelProvider: query.modelProvider, modelId: query.modelId }); setCursor(null); setDateError(false);
    } catch { setDateError(true); }
  }
  function selectPreset(value: DatePreset) {
    const range = dateRange(value);
    setPreset(value); setStart(range.start); setEnd(range.end); applyDates(range);
  }
  function selectModel(value: string) {
    const model = modelOptions.find(item => modelKey(item) === value);
    setCursor(null);
    setQuery({ ...query, asOf: summary?.asOf, modelProvider: model?.modelProvider, modelId: model?.modelId });
  }
  function drill(filters: Partial<UsageQuery> = {}) {
    setCursor(null); setQuery({ ...query, asOf: summary?.asOf, ...filters }); setTab("calls");
  }
  const current = summary?.current;
  return <section aria-label={t("aiUsage.aiUsage")} data-testid="ai-usage-report" className="mt-6 min-w-0 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2" aria-label={t("aiUsage.dateRange")}>
        {PRESETS.map(item => <Button key={item.value} size="sm" variant={preset === item.value ? "secondary" : "ghost"} aria-pressed={preset === item.value} onClick={() => selectPreset(item.value)}>{item.label}</Button>)}
        <Button size="sm" variant={preset === "custom" ? "secondary" : "ghost"} aria-pressed={preset === "custom"} onClick={() => setPreset("custom")}><CalendarDays className="size-4" aria-hidden />{t("aiUsage.customDates")}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t("aiUsage.filterModels")} data-testid="usage-model-filter" className="w-56" value={query.modelId ? modelKey({ modelProvider: query.modelProvider ?? "", modelId: query.modelId }) : "all"}
          options={[{ value: "all", label: t("aiUsage.allModels") }, ...modelOptions.map(item => ({ value: modelKey(item), label: `${item.modelId} · ${item.modelProvider}` }))]} onValueChange={selectModel} />
        <Button size="sm" variant="ghost" onClick={() => { const range = dateRange("week"); setStart(range.start); setEnd(range.end); setPreset("week"); setCursor(null); setDateError(false); setQuery(dateQuery(range.start, range.end)); }}>{t("aiUsage.resetFilters")}</Button>
      </div>
    </div>
    {preset === "custom" && <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
      <label className="space-y-2 text-13">{t("aiUsage.startDate")}<Input type="date" value={start} onChange={event => setStart(event.target.value)} /></label>
      <label className="space-y-2 text-13">{t("aiUsage.endDate")}<Input type="date" value={end} onChange={event => setEnd(event.target.value)} /></label>
      <Button onClick={() => applyDates({ start, end })}>{t("aiUsage.applyDates")}</Button>
      <p className="text-12 text-muted-foreground">{t("aiUsage.includesTheEndDateSelectUp")}</p>
    </div>}
    {dateError && <p role="alert" className="text-13 text-destructive">{t("aiUsage.chooseValidDatesTheEndDate")}</p>}
    <p className="text-12 text-muted-foreground">{`${usageDateLabel(query.start, locale)} — ${usageDateLabel(new Date(Date.parse(query.end) - 1).toISOString(), locale)}`} · {t("aiUsage.beijingTime")}</p>
    {summaryError && <div role="alert" className="rounded-lg border p-5"><p>{t("aiUsage.couldNotLoadUsagePleaseTry")}</p><Button className="mt-3" variant="outline" onClick={() => setReload(value => value + 1)}>{t("aiUsage.reload")}</Button></div>}
    {!summary && !summaryError && <div role="status" aria-label={t("aiUsage.loadingUsage")} className="grid gap-4 sm:grid-cols-3">{[1, 2, 3].map(key => <Skeleton key={key} className="h-28 rounded-xl" />)}</div>}
    {summary && current && <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label={t("aiUsage.calls")} value={current.callCount.toLocaleString(locale)} icon={<Activity className="size-4" aria-hidden />} note={current.failedCalls ? t("aiUsage.failedCount", { count: current.failedCalls }) : t("aiUsage.recordedCallsInTheSelectedDates")} />
        <Metric label={t("aiUsage.recordedUsage")} value={recordedTotal(current, locale)} testId="usage-total-tokens" icon={<Layers3 className="size-4" aria-hidden />} note={current.unknownCalls ? t("aiUsage.unknownCount", { count: current.unknownCalls, suffix: current.nativeCalls ? "" : " · Token" }) : current.nativeCalls ? t("aiUsage.imagesAudioAndOtherUsageAre") : t("aiUsage.tokensIncludesInputAndOutput")} />
        <Metric label={t("aiUsage.callCharges")} value={current.creditHundredths === undefined ? t("aiUsage.seeCallDetails") : `${creditLabel(current.creditHundredths, locale)} credit`} icon={<Coins className="size-4" aria-hidden />} note={current.pendingCreditCalls ? t("aiUsage.pendingCount", { count: current.pendingCreditCalls }) : t("aiUsage.creditsActuallyDeductedNativeCostsIn")} />
      </div>
      <div className="rounded-lg bg-muted/40 px-4 py-3 text-12 leading-6 text-muted-foreground">
        {t("aiUsage.onlyRecordedCallsAreShownUnreported")}
        {summary.unsettledDispatchIntents > 0 && <span>{t("aiUsage.unsettled", { count: summary.unsettledDispatchIntents })}</span>}
        {current.legacyCalls > 0 && <span>{t("aiUsage.legacyCount", { count: current.legacyCalls })}</span>}
        {summary.nativeUnits.map(unit => <span key={unit.unit} className="ml-2">{unit.reportedCalls > 0 && <span>{nativeQuantity({ unit: unit.unit, quantity: unit.reportedQuantity, source: "reported" }, locale)}{t("aiUsage.reportedSuffix")}</span>}{unit.estimatedCalls > 0 && <span>{nativeQuantity({ unit: unit.unit, quantity: unit.estimatedQuantity, source: "estimated" }, locale)} </span>}{unit.unknownCalls > 0 && <span>{t("aiUsage.nativeMissing", { unit: nativeUnitLabel(unit.unit, locale), count: unit.unknownCalls })}</span>}</span>)}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap" aria-label={t("aiUsage.usageViews")}><TabsTrigger value="summary">{t("aiUsage.overview")}</TabsTrigger><TabsTrigger value="calls">{t("aiUsage.callDetails")}</TabsTrigger><TabsTrigger value="models">{t("aiUsage.byModel")}</TabsTrigger></TabsList>
        <TabsContent value="summary" className="mt-4 space-y-4">
          <AiUsageOverview summary={summary} onDetails={(day?: string, grain?: UsageGrain) => {
            drill(day && grain ? {
              start: new Date(Math.max(Date.parse(query.start), Date.parse(usageMidnight(day, summary.timezone)))).toISOString(),
              end: new Date(Math.min(Date.parse(query.end), Date.parse(usageMidnight(usageBucketEnd(day, grain), summary.timezone)))).toISOString(),
            } : {});
          }} />
   {!selfUserId&&<><h3 className="font-semibold">{t("aiUsage.memberRanking")}</h3><div className="flex flex-wrap gap-2">{summary.members.map(member=><Button key={member.userId} className="h-auto max-w-full whitespace-normal break-all" variant="outline" onClick={()=>{drill({userId:member.userId});}}>{memberLabel(member.userId, selfUserId, names, locale)} · {formatTokens(member.totalTokens, locale)}</Button>)}
    {query.userId&&<Button variant="ghost" onClick={()=>drill({userId:undefined})}>{t("aiUsage.allAccessibleMembers")}</Button>}</div>
   </>}
   <h3 className="font-semibold">{t("aiUsage.providerAndModelDistribution")}</h3><div className="flex flex-wrap gap-2">{summary.models.map(item=><Button key={item.modelProvider+":"+item.modelId} className="h-auto max-w-full whitespace-normal break-all" variant="outline" onClick={()=>{drill({modelProvider:item.modelProvider,modelId:item.modelId});}}>{item.modelProvider} / {item.modelId} · {formatTokens(item.totalTokens, locale)}</Button>)}</div>
   {!selfUserId&&<><h3 className="font-semibold">{t("aiUsage.memberModel")}</h3><div className="flex flex-wrap gap-2">{summary.matrix.map(item=><Button key={item.userId+":"+item.modelProvider+":"+item.modelId} className="h-auto max-w-full whitespace-normal break-all" variant="outline" onClick={()=>{drill({userId:item.userId,modelProvider:item.modelProvider,modelId:item.modelId});}}>{memberLabel(item.userId, selfUserId, names, locale)} / {item.modelProvider} / {item.modelId} · {formatTokens(item.totalTokens, locale)}</Button>)}</div>
   </>}
   <h3 className="font-semibold">{t("aiUsage.projectAttribution")}</h3><div className="flex flex-wrap gap-2">{summary.projects.map(item=><Button key={item.projectId??"unassigned"} className="h-auto max-w-full whitespace-normal break-all" variant="outline" onClick={()=>{drill({projectId:item.projectId??undefined,unassignedProject:item.projectId===null?"true":undefined});}}>{item.projectId??t("aiUsage.unassignedProject")} · {formatTokens(item.totalTokens, locale)}</Button>)}</div>
          <Button variant="ghost" onClick={() => { setCursor(null); setQuery({ ...query, asOf: undefined, userId: undefined, modelProvider: undefined, modelId: undefined, projectId: undefined, unassignedProject: undefined }); }}>{t("aiUsage.clearGroupingFilters")}</Button>
        </TabsContent>
        <TabsContent value="calls" className="mt-4">
          <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border bg-card">
            {callsError && <div role="alert" className="p-6"><p>{t("aiUsage.couldNotLoadCallDetailsPlease")}</p><Button variant="outline" className="mt-3" onClick={() => setReload(value => value + 1)}>{t("aiUsage.reloadDetails")}</Button></div>}
            {!calls && !callsError && <div role="status" aria-label={t("aiUsage.loadingCallDetails")} className="space-y-3 p-6">{[1, 2, 3].map(key => <Skeleton key={key} className="h-12" />)}</div>}
            {calls && (calls.calls.length ? <AiUsageLedger orgId={orgId} selfUserId={selfUserId} calls={calls.calls} /> : <div className="space-y-2 px-6 py-12 text-center"><CalendarDays className="mx-auto size-6 text-muted-foreground" aria-hidden /><p className="font-medium">{t("aiUsage.noRecordedCalls")}</p><p className="text-13 text-muted-foreground">{t("aiUsage.tryOtherDatesOrModelsUnrecorded")}</p></div>)}
          </div>
          {calls && <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-12 text-muted-foreground">{t("aiUsage.pageCount", { count: calls.calls.length })}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!cursor} onClick={() => setCursor(null)}>{t("aiUsage.firstPage")}</Button><Button variant="outline" size="sm" disabled={!calls.nextCursor} onClick={() => setCursor(calls.nextCursor)}>{t("aiUsage.nextPage")}</Button></div></div>}
        </TabsContent>
        <TabsContent value="models" className="mt-4">
          <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>{t("aiUsage.model")}</TableHead><TableHead className="text-right">{t("aiUsage.calls")}</TableHead><TableHead className="text-right">{t("aiUsage.recordedTokens")}</TableHead><TableHead><span className="sr-only">{t("aiUsage.viewDetails")}</span></TableHead></TableRow></TableHeader><TableBody>
            {summary.models.map(item => <TableRow key={modelKey(item)}><TableCell><span className="font-medium">{item.modelId}</span><div className="mt-1 text-12 text-muted-foreground">{item.modelProvider}</div></TableCell><TableCell className="text-right tabular-nums">{item.callCount.toLocaleString(locale)}</TableCell><TableCell className="text-right tabular-nums">{current.unknownCalls === current.callCount && current.callCount > 0 ? t("aiUsage.notReported") : current.nativeCalls === current.callCount && current.callCount > 0 ? t("aiUsage.tokensNotApplicable") : item.totalTokens === "0" && item.callCount > 0 && (current.unknownCalls > 0 || current.nativeCalls > 0) ? t("aiUsage.usagePendingConfirmation") : formatTokens(item.totalTokens, locale)}<div className="text-12 text-muted-foreground">{current.unknownCalls || current.nativeCalls ? t("aiUsage.onlyRecordedTokensAreCountedUsage") : "Token"}</div></TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" aria-label={t("aiUsage.modelCalls", { model: item.modelId })} onClick={() => { selectModel(modelKey(item)); setTab("calls"); }}>{t("aiUsage.viewCalls")}</Button></TableCell></TableRow>)}
          </TableBody></Table>{!summary.models.length && <p className="p-8 text-center text-13 text-muted-foreground">{t("aiUsage.noModelCallsInTheSelected")}</p>}</div>
          {summary.truncated.models && <p className="mt-3 text-12 text-muted-foreground">{t("aiUsage.onlySomeModelsAreShownSelect")}</p>}
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
