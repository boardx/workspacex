/**
 * 2026-09-22 —— 本地版标识条的三条反证：
 *   ① 在线版不挂任何标识（否则在线界面上会出现一条说谎的「数据不出本机」）；
 *   ② 本地版**无条件**挂（不是 `hidden lg:block`——那正是改动前那条提示的问题）；
 *   ③ 能力差异清单逐字来自契约，不是界面自己编的一句安慰。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { CAPABILITY_AVAILABILITY_LABEL, capabilitiesMissingIn } from "@repo/contracts/deployment";
import { EditionProvider } from "@/lib/edition";
import { EditionBanner } from "@/components/shell/edition-banner";

it("renders nothing in the cloud edition", () => {
  render(<EditionProvider edition="cloud"><EditionBanner /></EditionProvider>);
  expect(screen.queryByTestId("edition-banner")).toBeNull();
});

it("is always present in the local edition, with no responsive hiding", () => {
  render(<EditionProvider edition="local"><EditionBanner /></EditionProvider>);
  const banner = screen.getByTestId("edition-banner");
  expect(within(banner).getByTestId("edition-banner-label").textContent).toBe("本地版");
  // 反证：改动前顶栏那条提示带 `hidden lg:block`，笔记本以下整条不渲染。
  expect(banner.className).not.toMatch(/\bhidden\b/);
});

it("lists exactly the contract's capability gaps, with the contract's own reason", () => {
  render(<EditionProvider edition="local"><EditionBanner /></EditionProvider>);
  const gaps = capabilitiesMissingIn("local");
  expect(gaps.length).toBeGreaterThan(0);
  fireEvent.click(screen.getByTestId("edition-banner-toggle"));
  const list = screen.getByTestId("edition-capability-gaps");
  expect(list.children.length).toBe(gaps.length);
  for (const row of gaps) {
    const item = within(list).getByTestId(`edition-capability-gap-${row.id}`);
    expect(item.textContent).toContain(row.capability);
    expect(item.textContent).toContain(row.why);
    expect(within(item).getByTestId(`edition-capability-state-${row.id}`).textContent)
      .toBe(`本地版${CAPABILITY_AVAILABILITY_LABEL[row.local]}`);
  }
});
