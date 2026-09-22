import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
}));

import { OrgMenu } from "@/components/shell/org-menu";
import { LOCAL_ORG_GUARANTEES, type Identity } from "@/lib/identity";

function identity(kind: "cloud" | "personal-local", orgName = "研发一部"): Identity {
  return {
    userId: "u1",
    displayName: "阿本",
    org: { id: "o1", name: orgName, kind },
    orgRole: "member",
    avatarUrl: null,
  } as unknown as Identity;
}

function open() {
  const t = screen.getByTestId("org-switcher");
  if (t.getAttribute("aria-expanded") !== "true") fireEvent.pointerDown(t, { button: 0 });
}

afterEach(cleanup);

describe("组织菜单先说「你在哪」", () => {
  it("只有一个组织时不渲染切不动的单选组", () => {
    render(<OrgMenu identity={identity("cloud")} organizations={[{ id: "o1", label: "研发一部" }]} onSelect={() => {}} />);
    open();
    expect(screen.getByTestId("org-menu-current").textContent).toContain("研发一部");
    expect(screen.queryByTestId("org-switcher-option-o1")).toBeNull();
    expect(screen.getByTestId("org-menu").textContent).not.toContain("切换组织");
  });

  it("云端单组织时，「当前所在」那一格的文本**就是**组织名，不多不少", () => {
    // e2e（`fullstack-smoke.spec.ts`）对这一格用的是 `toHaveText` 整串精确匹配。
    // 那条断言的强度取决于这一格不夹带别的文字——在这里先钉住，免得真栈上才发现。
    render(<OrgMenu identity={identity("cloud", "org org-fullstack")} organizations={[{ id: "o1", label: "org org-fullstack" }]} onSelect={() => {}} />);
    open();
    expect(screen.getByTestId("org-menu-current").textContent).toBe("org org-fullstack");
  });

  it("多个组织时照旧给出切换", () => {
    render(
      <OrgMenu
        identity={identity("cloud")}
        organizations={[{ id: "o1", label: "研发一部" }, { id: "o2", label: "市场部" }]}
        onSelect={() => {}}
      />,
    );
    open();
    expect(screen.getByTestId("org-menu").textContent).toContain("切换组织");
    expect(screen.getByTestId("org-switcher-option-o2")).toBeTruthy();
  });

  it("本地组织标出「本机工作区」并给出承诺原文", () => {
    render(<OrgMenu identity={identity("personal-local", "我的本地工作区")} organizations={[{ id: "o1", label: "我的本地工作区" }]} onSelect={() => {}} />);
    open();
    const note = screen.getByTestId("org-menu-local-note").textContent ?? "";
    expect(note).toContain("本机工作区");
    expect(note).toContain(LOCAL_ORG_GUARANTEES[0]!.statement);
  });

  it("云端组织不冒充本地", () => {
    render(<OrgMenu identity={identity("cloud")} organizations={[{ id: "o1", label: "研发一部" }]} onSelect={() => {}} />);
    open();
    expect(screen.queryByTestId("org-menu-local-note")).toBeNull();
  });

  it("多组织里选另一个仍然触发切换", () => {
    const onSelect = vi.fn();
    render(
      <OrgMenu
        identity={identity("cloud")}
        organizations={[{ id: "o1", label: "研发一部" }, { id: "o2", label: "市场部" }]}
        onSelect={onSelect}
      />,
    );
    open();
    fireEvent.click(screen.getByTestId("org-switcher-option-o2"));
    expect(onSelect).toHaveBeenCalledWith("o2");
  });
});
