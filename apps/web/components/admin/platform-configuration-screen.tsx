"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { AdminScreen } from "./admin-screen";
import { ProductCatalogSettings } from "./product-catalog-settings";
import { ConsumptionSettingsPanel } from "./consumption-settings-panel";
import { ConsolidationSettingPanel } from "./memory-ops-panels";
import { PlatformExtractionSettingPanel } from "./platform-extraction-setting-panel";

export function PlatformConfigurationScreen({ state }: { state: UiState }) {
  const { t, locale } = useI18n();
  const [category, setCategory] = useState<"system" | "module">("module");
  const [billingSection, setBillingSection] = useState<"subscriptions" | "credits">("credits");
  const [market, setMarket] = useState<"cn" | "us">("cn");
  const isChinese = locale === "zh-CN";
  const title = t("adminNavigation.item.configuration");

  return (
    <AdminScreen state={state} moduleLabel={title} title={title} hideOrgIdentity liveBacked
      intro={isChinese ? "查看和编辑当前部署的配置。" : "View and edit settings for this deployment."}
      emptyHint={isChinese ? "暂无配置。" : "No settings available."}
      denialReason={t("platformOps.denial")} successMessage={t("platformOps.consumption.saved")}>
      <div role="group" aria-label={title} className="flex flex-wrap gap-2 border-b border-border pb-3">
        <Button variant={category === "system" ? "secondary" : "ghost"} aria-pressed={category === "system"}
          onClick={() => setCategory("system")}>
          {isChinese ? "系统配置" : "System settings"}
        </Button>
        <Button variant={category === "module" ? "secondary" : "ghost"} aria-pressed={category === "module"}
          onClick={() => setCategory("module")}>
          {isChinese ? "模块配置" : "Module settings"}
        </Button>
      </div>
      {category === "system" ? (
        <div className="space-y-4">
          <PlatformExtractionSettingPanel />
          <ConsolidationSettingPanel />
        </div>
      ) : (
        <section className="space-y-4" aria-labelledby="platform-configuration-credits">
          <h2 id="platform-configuration-credits" className="sr-only">{isChinese ? "计费配置" : "Billing settings"}</h2>
          <div className="flex gap-2">
            <Button variant={billingSection === "subscriptions" ? "secondary" : "ghost"} aria-pressed={billingSection === "subscriptions"}
              onClick={() => setBillingSection("subscriptions")}>{isChinese ? "订阅与套餐" : "Subscriptions"}</Button>
            <Button variant={billingSection === "credits" ? "secondary" : "ghost"} aria-pressed={billingSection === "credits"}
              onClick={() => setBillingSection("credits")}>{isChinese ? "积分" : "Credits"}</Button>
          </div>
          <div role="group" aria-label={isChinese ? "计费市场" : "Billing market"} className="flex flex-wrap gap-2">
            {(["cn", "us"] as const).map((option) => (
              <Button key={option} type="button" variant={market === option ? "secondary" : "ghost"}
                aria-pressed={market === option} onClick={() => setMarket(option)}>
                {option === "cn" ? (isChinese ? "中国市场" : "China") : (isChinese ? "美国市场" : "United States")}
              </Button>
            ))}
          </div>
          {billingSection === "credits" && <ConsumptionSettingsPanel key={market} market={market} />}
          <ProductCatalogSettings key={market + billingSection} market={market} kind={billingSection === "credits" ? "credit_topup" : "subscription"} />
        </section>
      )}
    </AdminScreen>
  );
}
