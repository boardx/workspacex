import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlatformConfigurationScreen } from "@/components/admin/platform-configuration-screen";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({ locale: "zh-CN", t: (key: string) => key }),
}));
vi.mock("@/components/admin/admin-screen", () => ({
  AdminScreen: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/admin/consumption-settings-panel", () => ({
  ConsumptionSettingsPanel: ({ market }: { market: string }) => <output>倍率 {market}</output>,
}));
vi.mock("@/components/admin/product-catalog-settings", () => ({
  ProductCatalogSettings: ({ market, kind }: { market: string; kind: string }) => <output>{kind} {market}</output>,
}));
vi.mock("@/components/admin/memory-ops-panels", () => ({ ConsolidationSettingPanel: () => null }));
vi.mock("@/components/admin/platform-extraction-setting-panel", () => ({ PlatformExtractionSettingPanel: () => null }));

afterEach(cleanup);

it("applies one market to the rate and catalog and retains it when switching billing sections", () => {
  render(<PlatformConfigurationScreen state="default" />);
  expect(screen.getByText("倍率 cn")).toBeTruthy();
  expect(screen.getByText("credit_topup cn")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "美国市场" }));
  expect(screen.getByText("倍率 us")).toBeTruthy();
  expect(screen.getByText("credit_topup us")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "订阅与套餐" }));
  expect(screen.getByText("subscription us")).toBeTruthy();
  expect(screen.queryByText("倍率 us")).toBeNull();
});
