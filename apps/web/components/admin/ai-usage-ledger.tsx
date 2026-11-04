"use client";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrgMemberNames, memberLabel } from "@/lib/use-org-member-names";
import type { UsageCalls } from "@/lib/live-ai-usage";
import { creditLabel, costLabel, formatTokens, nativeQuantity, usageDateLabel, usageDay, usageTime } from "./ai-usage-format";

const callTimestamp = (call: UsageCalls["calls"][number]) => call.startedAt ?? call.occurredAt;

export function AiUsageLedger({ calls, orgId, selfUserId }: { calls: UsageCalls["calls"]; orgId: string; selfUserId?: string }) {
  const { locale, t } = useI18n();
  const names = useOrgMemberNames(selfUserId ? null : orgId);
  const days = new Map<string, UsageCalls["calls"]>();
  for (const call of calls) {
    // Match the API date filter (request start, falling back to receipt time).
    // Cursor identity continues to use occurredAt unchanged.
    const day = usageDay(callTimestamp(call));
    days.set(day, [...(days.get(day) ?? []), call]);
  }
  return <Table data-testid="usage-ledger">
    <TableHeader><TableRow>
      <TableHead>{t("aiUsage.callTime")}</TableHead><TableHead>{t("aiUsage.model")}</TableHead>{!selfUserId && <TableHead>{t("aiUsage.member")}</TableHead>}
      <TableHead className="text-right">{t("aiUsage.inputTokens")}</TableHead><TableHead className="text-right">{t("aiUsage.outputTokens")}</TableHead>
      <TableHead>{t("aiUsage.payer")}</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">{t("aiUsage.totalUsage")}</TableHead><TableHead className="text-right">{t("aiUsage.cost")}</TableHead><TableHead>{t("aiUsage.status")}</TableHead>
    </TableRow></TableHeader>
    {[...days].sort(([left], [right]) => right.localeCompare(left)).map(([day, rows]) => <TableBody key={day}>
      <TableRow className="bg-muted/40 transition-colors hover:bg-muted/40"><TableCell colSpan={selfUserId ? 9 : 10} className="py-3 font-medium">{usageDateLabel(`${day}T00:00:00+08:00`, locale)}</TableCell></TableRow>
      {[...rows].sort((left, right) => Date.parse(callTimestamp(right)) - Date.parse(callTimestamp(left))).map(call => <TableRow key={call.id}>
        <TableCell className="whitespace-nowrap align-top tabular-nums">{usageTime(callTimestamp(call), locale)}</TableCell>
        <TableCell className="min-w-40 align-top"><span className="font-medium break-all">{call.modelId}</span><div className="mt-1 text-12 text-muted-foreground">{call.modelProvider}</div></TableCell>
        {!selfUserId && <TableCell className="align-top">{memberLabel(call.userId, selfUserId, names, locale)}</TableCell>}
        <TableCell className="text-right align-top tabular-nums">{call.totalSource === "not-applicable" ? "—" : formatTokens(call.inputTokens, locale)}</TableCell>
        <TableCell className="text-right align-top tabular-nums">{call.totalSource === "not-applicable" ? "—" : formatTokens(call.outputTokens, locale)}</TableCell>
        <TableCell className="align-top">{call.payer ? call.payer.ownerType === "user" ? t("aiUsage.personalAccount") : `${t("aiUsage.organizationAccount")}${call.organizationName ? ` · ${call.organizationName}` : ""}` : t("aiUsage.noData")}</TableCell>
        <TableCell className="text-right align-top tabular-nums">{call.creditStatus === "unbilled" ? t("aiUsage.legacyUnbilled") : creditLabel(call.creditHundredths, locale)}{call.creditStatus === "pending" && <p className="text-12 text-muted-foreground">{t("aiUsage.pendingReconciliation")}</p>}</TableCell>
        <TableCell className="min-w-40 text-right align-top tabular-nums">
          <span className="font-medium">{call.nativeUsage ? nativeQuantity(call.nativeUsage, locale) : call.totalSource === "unknown" ? t("aiUsage.notReported") : call.totalSource === "not-applicable" ? t("aiUsage.tokensNotApplicable") : formatTokens(call.totalTokens, locale)}</span>
          <details className="mt-2 text-12 text-muted-foreground"><summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("aiUsage.meteringDetails")}</summary>
            <div className="mt-2 space-y-1">
              {call.totalSource === "not-applicable" ? <p>{t("aiUsage.tokensNotApplicable")}</p> : <><p>{t("aiUsage.cachedInput")}{formatTokens(call.cacheInputTokens, locale)}</p><p>{t("aiUsage.reasoningOutput")}{formatTokens(call.reasoningOutputTokens, locale)}</p><p>{t("aiUsage.cachedAndReasoningUsageIsIncluded")}</p></>}
              {call.totalSource === "legacy" && <p>{t("aiUsage.legacyMeasurement")}</p>}
            </div>
          </details>
        </TableCell>
        <TableCell className="whitespace-nowrap text-right align-top tabular-nums">{costLabel(call, locale)}</TableCell>
        <TableCell className="whitespace-nowrap align-top"><span className={call.outcome === "failed" ? "text-destructive" : "text-muted-foreground"}>{call.outcome === "failed" ? t("aiUsage.failed") : t("aiUsage.succeeded")}</span></TableCell>
      </TableRow>)}
    </TableBody>)}
  </Table>;
}
