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
import { CATALOG_CAPABILITY_LABELS, CATALOG_MODALITY_LABELS, filterProviderModels } from "@/lib/provider-model-catalog-view";

const PAGE_SIZE = 12;

/** Public metadata has no authority to register, enable, price, or dispatch tenant models. */
export function BailianModelCatalog({
  catalog = bailianModelCatalog,
  onViewOrganizationModels,
}: {
  catalog?: ProviderModelCatalog;
  onViewOrganizationModels: () => void;
}) {
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
    <section aria-label="百炼公共模型目录" data-testid="bailian-catalog" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-card-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">百炼公共目录 <span className="text-sm font-normal text-muted-foreground">{catalog.models.length} 个模型</span></h2>
          <Badge tone="outline">公开资料快照 · {catalog.observedAt.slice(0, 10)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">查看模型规格，再到组织模型池配置并测试。收录不会自动启用，也不会直接进入 Skills 或工作流的可选范围。</p>
        <p className="text-xs text-muted-foreground" data-testid="bailian-catalog-coverage">覆盖公开指南列出的模型与明确快照；账号可用范围、全部历史版本、地域价格及完整 API 参数尚未核验。规格摘要以详情中的官方来源为准。</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Input aria-label="搜索百炼模型" placeholder="模型 ID、原厂商或能力…" value={query} data-testid="bailian-search" className="min-w-0 sm:flex-1" onChange={(event) => { setQuery(event.currentTarget.value); setPage(0); }} />
        <Select aria-label="筛选模型能力" data-testid="bailian-capability-filter" value={capability} onValueChange={(value) => { setCapability(value); setPage(0); }} options={[{ value: "all", label: "全部能力" }, ...capabilities.map((value) => ({ value, label: CATALOG_CAPABILITY_LABELS[value] }))]} />
        <Select aria-label="筛选原厂商" data-testid="bailian-vendor-filter" value={vendor} onValueChange={(value) => { setVendor(value); setPage(0); }} options={[{ value: "all", label: "全部原厂商" }, ...vendors.map((value) => ({ value, label: value }))]} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground" data-testid="bailian-result-count">找到 {matches.length} 个模型{matches.length > 0 && `，显示 ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, matches.length)}`}</p>
        {(query || capability !== "all" || vendor !== "all") && <Button size="xs" variant="ghost" onClick={reset}>清除筛选</Button>}
      </div>
      {matches.length === 0 ? (
        <div data-testid="bailian-empty" className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm">没有匹配的模型，试试其他名称或移除筛选条件。</p>
          <Button variant="outline" size="sm" onClick={reset}>查看全部模型</Button>
        </div>
      ) : (
        <div data-testid="bailian-model-list" className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((model) => (
            <ResourceCard key={model.modelId} testId={`bailian-model-${model.modelId}`} title={<span className="break-all font-mono text-sm">{model.displayName}</span>} subtitle={`${model.originalVendor ?? "原厂商待核验"} · 阿里云百炼接入`} onClick={() => setSelectedId(model.modelId)} ariaLabel={`查看 ${model.displayName} 规格`}>
              <div className="flex flex-wrap gap-1">{model.capabilities.map((value) => <Badge key={value} tone="outline">{CATALOG_CAPABILITY_LABELS[value]}</Badge>)}</div>
              <p className="text-xs text-muted-foreground">{model.contextWindow === null ? "上下文规格待核验" : `上下文 ${model.contextWindow.toLocaleString("zh-CN")} Token`}</p>
              <p className="text-xs text-muted-foreground">组织可用性未核验 · 需配置并测试</p>
            </ResourceCard>
          ))}
        </div>
      )}
      {matches.length > PAGE_SIZE && (
        <nav aria-label="百炼模型分页" className="flex flex-wrap items-center justify-center gap-3">
          <Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</Button>
          <span className="text-sm text-muted-foreground">第 {currentPage + 1} / {maxPage + 1} 页</span>
          <Button size="sm" variant="outline" disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}>下一页</Button>
        </nav>
      )}
      {selected && <CatalogDetails model={selected} onClose={() => setSelectedId(null)} onViewOrganizationModels={onViewOrganizationModels} />}
    </section>
  );
}

function CatalogDetails({ model, onClose, onViewOrganizationModels }: {
  model: ProviderModelCatalogEntry; onClose: () => void; onViewOrganizationModels: () => void;
}) {
  return (
    <AdminDrawer testid="bailian-model-detail" title={model.displayName} subtitle="公共规格摘要 · 组织可用性尚未验证" onClose={onClose} width="lg" footer={<Button size="sm" variant="outline" onClick={() => { onClose(); onViewOrganizationModels(); }}>查看组织模型池</Button>}>
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col divide-y divide-border">
          <KV k="模型 ID" v={<span className="break-all font-mono">{model.modelId}</span>} />
          <KV k="原厂商" v={model.originalVendor ?? "待核验"} />
          <KV k="接入平台" v="阿里云百炼" />
          <KV k="能力" v={model.capabilities.map((value) => CATALOG_CAPABILITY_LABELS[value]).join("、")} />
          <KV k="输入" v={model.inputModalities.map((value) => CATALOG_MODALITY_LABELS[value]).join("、") || "待核验"} />
          <KV k="输出" v={model.outputModalities.map((value) => CATALOG_MODALITY_LABELS[value]).join("、") || "待核验"} />
          <KV k="输入输出核验" v={model.modalityCoverage === "documented" ? "已记录公开逐行规格，不代表完整模态与调用适配已核验" : model.modalityCoverage === "partial" ? "部分规格已记录，其余待核验" : "待核验，不按模型类别推断输入输出"} />
          <KV k="地域" v={model.regionCoverage === "unknown" ? "待核验，不能据此判断账号可用性" : model.regions.join("、")} />
          <KV k="组织接入" v="需配置并测试；目录不代表适配器已就绪" />
          <KV k="价格" v="尚未核验，不能用于报价或费用预留" />
          <KV k="计费单位" v={model.billing.unit ?? "待核验（不同模态不能统一按 Token 计费）"} />
        </div>
        <section className="flex flex-col gap-2" aria-label="模型规格摘要">
          <h3 className="text-sm font-semibold">规格摘要</h3>
          <p className="text-xs text-muted-foreground">每项保留适用范围；这些资料不是可直接执行的完整请求参数。</p>
          {model.parameters.length === 0 ? <p className="text-sm text-muted-foreground">此模型暂无已核验的规格摘要，请查看官方说明。</p> : model.parameters.map((fact, index) => (
            <div key={`${fact.sourceUrl}-${fact.scope}-${fact.name}-${index}`} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{fact.name}</span><span className="break-all">{fact.value}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">范围：{fact.scope}</p>
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-2" aria-label="模型官方来源">
          <h3 className="text-sm font-semibold">官方来源</h3>
          {model.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="rounded-sm text-sm text-primary underline underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:ring-ring">{source.title} · 核验日期 {source.observedAt.slice(0, 10)}</a>)}
        </section>
        <p className="text-xs text-muted-foreground">使用路径：组织管理员配置模型 → 验证适配和计费规格 → 通过准入后，供 Skills、空间与工作流选择。公共目录不保存密钥。</p>
      </div>
    </AdminDrawer>
  );
}
