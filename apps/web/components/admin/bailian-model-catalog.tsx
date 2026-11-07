"use client";

import * as React from "react";
import { bailianModelCatalog } from "@repo/contracts/bailian-model-catalog";
import type { ProviderModelCatalog, ProviderModelCatalogEntry } from "@repo/contracts/provider-model-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ResourceCard } from "@/components/ui/resource-card";
import { AdminDrawer, KV } from "./panel";
import { filterProviderModels } from "@/lib/provider-model-catalog-view";
import { useI18n } from "@/lib/i18n/provider";

const PAGE_SIZE = 12;

/** Public metadata has no authority to register, enable, price, or dispatch tenant models. */
export function BailianModelCatalog({
  catalog = bailianModelCatalog,
  onViewOrganizationModels,
}: {
  catalog?: ProviderModelCatalog;
  onViewOrganizationModels: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState("");
  const [capability, setCapability] = React.useState("all");
  const [vendor, setVendor] = React.useState("all");
  const [page, setPage] = React.useState(0);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const vendors = React.useMemo(() => [...new Set(catalog.models.flatMap((model) => model.originalVendor ? [model.originalVendor] : []))].sort(), [catalog]);
  const capabilities = React.useMemo(() => [...new Set(catalog.models.flatMap((model) => model.capabilities))], [catalog]);
  const matches = React.useMemo(() => filterProviderModels(catalog.models, query, capability, vendor), [catalog, query, capability, vendor]);
  const maxPage = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, maxPage);
  const visible = matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selected = catalog.models.find((model) => model.modelId === selectedId);
  const reset = () => { setQuery(""); setCapability("all"); setVendor("all"); setPage(0); };
  return (
    <section aria-label={t("public.title")} data-testid="bailian-catalog" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-card-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("model.public")} <span className="text-sm font-normal text-muted-foreground">{t("public.count", { count: catalog.models.length })}</span></h2>
          <Badge tone="outline">{t("public.snapshot", { date: catalog.observedAt.slice(0, 10) })}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t("public.intro")}</p>
        <p className="text-xs text-muted-foreground" data-testid="bailian-catalog-coverage">{t("public.coverage")}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Input aria-label={t("public.search")} placeholder={t("public.searchPlaceholder")} value={query} data-testid="bailian-search" className="min-w-0 sm:flex-1" onChange={(event) => { setQuery(event.currentTarget.value); setPage(0); }} />
        <Select aria-label={t("public.filterCapability")} data-testid="bailian-capability-filter" value={capability} onValueChange={(value) => { setCapability(value); setPage(0); }} options={[{ value: "all", label: t("public.allCapabilities") }, ...capabilities.map((value) => ({ value, label: t(`public.capability.${value}`) }))]} />
        <Select aria-label={t("public.filterVendor")} data-testid="bailian-vendor-filter" value={vendor} onValueChange={(value) => { setVendor(value); setPage(0); }} options={[{ value: "all", label: t("public.allVendors") }, ...vendors.map((value) => ({ value, label: value }))]} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground" data-testid="bailian-result-count">{t("public.results", { count: matches.length })}{matches.length > 0 && t("public.showing", { start: currentPage * PAGE_SIZE + 1, end: Math.min((currentPage + 1) * PAGE_SIZE, matches.length) })}</p>
        {(query || capability !== "all" || vendor !== "all") && <Button size="xs" variant="ghost" onClick={reset}>{t("public.clear")}</Button>}
      </div>
      {matches.length === 0 ? (
        <div data-testid="bailian-empty" className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm">{t("public.empty")}</p>
          <Button variant="outline" size="sm" onClick={reset}>{t("public.viewAll")}</Button>
        </div>
      ) : (
        <div data-testid="bailian-model-list" className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((model) => (
            <ResourceCard key={model.modelId} testId={`bailian-model-${model.modelId}`} title={<span className="break-all font-mono text-sm">{model.displayName}</span>} subtitle={`${model.originalVendor ?? t("public.unknownVendor")} · ${t("public.connection")}`} onClick={() => setSelectedId(model.modelId)} ariaLabel={t("public.viewSpecs", { name: model.displayName })}>
              <div className="flex flex-wrap gap-1">{model.capabilities.map((value) => <Badge key={value} tone="outline">{t(`public.capability.${value}`)}</Badge>)}</div>
              <p className="text-xs text-muted-foreground">{model.contextWindow === null ? t("public.unknownContext") : t("public.context", { value: model.contextWindow.toLocaleString("zh-CN") })}</p>
              <p className="text-xs text-muted-foreground">{t("public.availability")}</p>
            </ResourceCard>
          ))}
        </div>
      )}
      {matches.length > PAGE_SIZE && (
        <nav aria-label={t("public.pagination")} className="flex flex-wrap items-center justify-center gap-3">
          <Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("public.previous")}</Button>
          <span className="text-sm text-muted-foreground">{t("public.page", { page: currentPage + 1, total: maxPage + 1 })}</span>
          <Button size="sm" variant="outline" disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}>{t("public.next")}</Button>
        </nav>
      )}
      {selected && <CatalogDetails model={selected} onClose={() => setSelectedId(null)} onViewOrganizationModels={onViewOrganizationModels} />}
    </section>
  );
}

function CatalogDetails({ model, onClose, onViewOrganizationModels }: {
  model: ProviderModelCatalogEntry; onClose: () => void; onViewOrganizationModels: () => void;
}) {
  const { t } = useI18n();
  return (
    <AdminDrawer testid="bailian-model-detail" title={model.displayName} subtitle={t("public.detailSubtitle")} onClose={onClose} width="lg" footer={<Button size="sm" variant="outline" onClick={() => { onClose(); onViewOrganizationModels(); }}>{t("public.viewOrganization")}</Button>}>
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col divide-y divide-border">
          <KV k={t("model.id")} v={<span className="break-all font-mono">{model.modelId}</span>} />
          <KV k={t("public.vendor")} v={model.originalVendor ?? t("public.pending")} />
          <KV k={t("public.platform")} v={t("public.bailian")} />
          <KV k={t("public.capabilities")} v={model.capabilities.map((value) => t(`public.capability.${value}`)).join("、")} />
          <KV k={t("public.input")} v={model.inputModalities.map((value) => t(`public.modality.${value}`)).join("、") || t("public.pending")} />
          <KV k={t("public.output")} v={model.outputModalities.map((value) => t(`public.modality.${value}`)).join("、") || t("public.pending")} />
          <KV k={t("public.modalityVerification")} v={t(model.modalityCoverage === "documented" ? "public.documented" : model.modalityCoverage === "partial" ? "public.partial" : "public.unknownModalities")} />
          <KV k={t("public.regions")} v={model.regionCoverage === "unknown" ? t("public.unknownRegions") : model.regions.join("、")} />
          <KV k={t("public.admission")} v={t("public.admissionHint")} />
          <KV k={t("public.price")} v={t("public.priceHint")} />
          <KV k={t("public.billingUnit")} v={model.billing.unit ?? t("public.unknownBilling")} />
        </div>
        <section className="flex flex-col gap-2" aria-label={t("public.summaryAria")}>
          <h3 className="text-sm font-semibold">{t("public.summary")}</h3>
          <p className="text-xs text-muted-foreground">{t("public.summaryHint")}</p>
          {model.parameters.length === 0 ? <p className="text-sm text-muted-foreground">{t("public.noSummary")}</p> : model.parameters.map((fact, index) => (
            <div key={`${fact.sourceUrl}-${fact.scope}-${fact.name}-${index}`} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{fact.name}</span><span className="break-all">{fact.value}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">{t("public.scope", { scope: fact.scope })}</p>
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-2" aria-label={t("public.sourcesAria")}>
          <h3 className="text-sm font-semibold">{t("public.sources")}</h3>
          {model.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="rounded-sm text-sm text-primary underline underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:ring-ring">{source.title} · {t("public.observed", { date: source.observedAt.slice(0, 10) })}</a>)}
        </section>
        <p className="text-xs text-muted-foreground">{t("public.path")}</p>
      </div>
    </AdminDrawer>
  );
}
