import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

let mockPath = "/chat";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
}));

import { IconRail } from "@/components/shell/icon-rail";
import { MOCK_ORGS, mockIdentity } from "@/lib/identity";
import { navSegmentsForViewer } from "@/lib/navigation";

const IDENTITY = { ...mockIdentity("org-yuanyang", null), orgRole: "admin" as const };
const ORGS = MOCK_ORGS.map((o) => ({ id: o.id, label: o.name }));
const OVERFLOW_KEYS = ["whiteboard", "recording", "survey", "design-workbench", "feedback-drafts"];

function renderRail() {
  return render(
    <IconRail identity={IDENTITY} organizations={ORGS} onSwitchOrganization={() => undefined} avatarInitial="X" />,
  );
}
describe("IconRail 完整纯图标导航", () => {
  afterEach(() => { cleanup(); mockPath = "/chat"; });

  it("全部有权一级入口直接唯一显示，文字只通过可访问名称和提示提供", () => {
    renderRail();
    const rail = screen.getByTestId("rail-scroll");
    const items = navSegmentsForViewer({ orgName: "x", orgRole: "admin", platformOperator: false }).flatMap(s => s.items);
    for (const item of items) {
      const link = within(rail).getByTestId(`rail-${item.key}`);
      expect(screen.getAllByTestId(`rail-${item.key}`)).toHaveLength(1);
      expect(link.getAttribute("aria-label")).toBeTruthy();
      expect(link.textContent).toBe("");
      expect(link.querySelector("svg")).not.toBeNull();
    }
    for (const key of OVERFLOW_KEYS) expect(within(rail).getByTestId(`rail-${key}`)).toBeTruthy();
    expect(screen.queryByTestId("rail-agent-directory")).toBeNull();
    expect(screen.queryByTestId("rail-work-skill-catalog")).toBeNull();
    expect(screen.queryByTestId("rail-more")).toBeNull();
    expect(screen.queryByTestId("rail-platform-admin")).toBeNull();
  });

  it("保留的一级入口直接高亮", () => {
    for (const [path, key] of [["/studio/board", "whiteboard"], ["/studio/design-workbench", "design-workbench"]]) {
      mockPath = path!;
      renderRail();
      expect(screen.getByTestId(`rail-${key}`).getAttribute("aria-current")).toBe("page");
      cleanup();
    }
  });
});
