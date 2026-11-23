"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { ConfigurationLayout, configurationGroups, type ConfigurationCategory } from "./configuration-layout";
import { AdminScreen } from "./admin-screen";
import { ProductCatalogSettings } from "./product-catalog-settings";
import { ConsumptionSettingsPanel } from "./consumption-settings-panel";
import { ConsolidationSettingPanel, ExtractionSloPanel } from "./memory-ops-panels";
import { TelemetryConsentPanel } from "./telemetry-settings-screen";
import { PlatformExtractionSettingPanel } from "./platform-extraction-setting-panel";

export function PlatformConfigurationScreen({ state }: { state: UiState }) {
  const { t, locale } = useI18n();
  const [category, setCategory] = useState<ConfigurationCategory>("module");
  const [group, setGroup] = useState("积分");
  const [market, setMarket] = useState<"cn" | "us">("cn");
  const isChinese = locale === "zh-CN";
  const title = t("adminNavigation.item.configuration");

  return (
    <AdminScreen state={state} moduleLabel={title} title={title} hideOrgIdentity liveBacked
      intro={isChinese ? "查看和编辑当前部署的配置。" : "View and edit settings for this deployment."}
      emptyHint={isChinese ? "暂无配置。" : "No settings available."}
      denialReason={t("platformOps.denial")} successMessage={t("platformOps.consumption.saved")}>
      <ConfigurationLayout category={category} group={group} chinese={isChinese}
        onCategory={(key) => { setCategory(key); setGroup(configurationGroups[key][0]); }}
        onGroup={setGroup}>
      {group === "平台能力与治理" ? (
        <div className="space-y-4">
          <PlatformExtractionSettingPanel />
          <ConsolidationSettingPanel />
        </div>
      ) : group === "数据治理" ? (
        <TelemetryConsentPanel />
      ) : group === "知识图谱与检索" ? (
        <div className="space-y-4">
          <PlatformExtractionSettingPanel />
          <ConsolidationSettingPanel />
          <ExtractionSloPanel />
        </div>
      ) : group === "积分" || group === "订阅与套餐" ? (
        <section className="space-y-4" aria-labelledby="platform-configuration-credits">
          <h2 id="platform-configuration-credits" className="sr-only">{isChinese ? "计费配置" : "Billing settings"}</h2>
          <div role="group" aria-label={isChinese ? "计费市场" : "Billing market"} className="flex flex-wrap gap-2">
            {(["cn", "us"] as const).map((option) => (
              <Button key={option} type="button" variant={market === option ? "secondary" : "ghost"}
                aria-pressed={market === option} onClick={() => setMarket(option)}>
                {option === "cn" ? (isChinese ? "中国市场" : "China") : (isChinese ? "美国市场" : "United States")}
              </Button>
            ))}
          </div>
          {group === "积分" && <ConsumptionSettingsPanel key={market} market={market} />}
          <ProductCatalogSettings key={market + group} market={market} kind={group === "积分" ? "credit_topup" : "subscription"} />
        </section>
      ) : (
        <p className="rounded-control border border-border bg-card p-4 text-sm text-muted-foreground">
          {isChinese ? "此分组暂未接入可编辑配置。" : "Editable settings are not yet available for this group."}
        </p>
      )}
      </ConfigurationLayout>
    </AdminScreen>
  );
}
