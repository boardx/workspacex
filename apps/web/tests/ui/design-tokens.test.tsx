/**
 * 对标 R1（#3933）—— 设计 token：任意品牌色与字体。
 *
 * 钉住：品牌色真的落到画布根（覆盖强调色档位，低保真时让位）；字体栈落到画布根；外观面板里
 * 品牌色输入**只在合法且回车/失焦时**提交（打到一半不刷画布）；用着品牌色时点档位 = 换回档位；
 * 选字体走 `updateProject` 的 `tokens`（按键合并，只发变了的键）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/design",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import * as React from "react";
import { designWorkbench } from "@repo/contracts";
import { DesignDetailScreen } from "@/components/design-loop/detail-screen";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import type { DesignProject, DesignTokens } from "@/lib/live-design-workbench";

afterEach(() => { cleanup(); apiRequest.mockReset(); });

const page = {
  type: "stack" as const, id: "s",
  children: [
    { type: "text" as const, id: "t", props: { content: "山野餐厅", variant: "title" as const } },
    { type: "button" as const, id: "b", props: { label: "立即订座", variant: "primary" as const } },
  ],
};

function project(over: Partial<DesignProject> = {}): DesignProject {
  return {
    id: "p1", name: "订座", template: "mobile", theme: "light", accent: "blue",
    tokens: { brand: null, font: "sans" }, tags: [], refImages: [], share: null,
    problem: "", criteria: [], frames: ["首页"], prototype: [page] as never, frameNotes: [],
    pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
    chat: [], ownerId: "u1", ownerName: "我", createdAt: "2026-09-23T00:00:00.000Z", updatedAt: "2026-09-23T00:00:00.000Z",
    ...over,
  };
}

describe("画布根：品牌色与字体", () => {
  it("品牌色覆盖强调色档位：--primary 就是品牌色，data-brand 标出来，data-accent 不再说是 blue", () => {
    // ⭐ 反证锚点：画布根不读 `tokens.brand` ⇒ 这条红——用户说了自己的橙，画布还是某一档蓝。
    render(<PrototypeCanvas label="首页" root={page} accent="blue" theme="light" tokens={{ brand: "#FF5A1F", font: "sans" }} />);
    const phone = screen.getByTestId("design-detail-phone");
    expect(phone.style.getPropertyValue("--primary")).toBe(designWorkbench.brandAccentTokens("#FF5A1F").primary);
    expect(phone.style.getPropertyValue("--ring")).toBe(designWorkbench.brandAccentTokens("#FF5A1F").primary);
    expect(phone.getAttribute("data-brand")).toBe("#FF5A1F");
    expect(phone.getAttribute("data-accent")).toBeNull();
  });

  it("低保真（线框图）时品牌色同样让位——线框图的意义就是别谈颜色；字体不受影响", () => {
    render(<PrototypeCanvas label="首页" root={page} wireframe theme="light" tokens={{ brand: "#FF5A1F", font: "serif" }} />);
    const phone = screen.getByTestId("design-detail-phone");
    expect(phone.getAttribute("data-brand")).toBeNull();
    expect(phone.style.fontFamily).toContain("serif");
  });

  it("字体：serif 写字体栈；sans 不写任何 style（老项目逐像素不变）", () => {
    const { rerender } = render(<PrototypeCanvas label="首页" root={page} tokens={{ brand: null, font: "serif" }} />);
    expect(screen.getByTestId("design-detail-phone").style.fontFamily).toContain("Noto Serif SC");
    expect(screen.getByTestId("design-detail-phone").getAttribute("data-font")).toBe("serif");
    rerender(<PrototypeCanvas label="首页" root={page} tokens={{ brand: null, font: "sans" }} />);
    expect(screen.getByTestId("design-detail-phone").style.fontFamily).toBe("");
    expect(screen.getByTestId("design-detail-phone").getAttribute("data-font")).toBeNull();
  });
});

function mockServer(initial: Partial<DesignProject> = {}) {
  let current = project(initial);
  const patches: Record<string, unknown>[] = [];
  apiRequest.mockImplementation(async (path: string, opts?: { method?: string; body?: Record<string, unknown> }) => {
    if (path === "/pm-designs") return { items: [current] };
    if (path === "/pm-designs/p1" && opts?.method === "PATCH") {
      const body = opts.body ?? {};
      patches.push(body);
      const { tokens, ...rest } = body as { tokens?: Partial<DesignTokens> };
      current = { ...current, ...rest, tokens: { ...current.tokens, ...(tokens ?? {}) } } as DesignProject;
      return { project: current };
    }
    throw new Error(`unexpected ${path}`);
  });
  return patches;
}

async function openPanel() {
  render(<DesignDetailScreen projectId="p1" />);
  await screen.findByTestId("design-detail");
  fireEvent.click(screen.getByTestId("design-detail-view-single"));
  fireEvent.click(screen.getByTestId("design-detail-appearance"));
  await screen.findByTestId("design-detail-appearance-panel");
}

describe("外观面板：品牌色输入与字体", () => {
  it("品牌色：打到一半不提交、给出人话提示；合法且回车才写回（统一大写），画布立即变色", async () => {
    const patches = mockServer();
    await openPanel();
    const input = screen.getByTestId("design-detail-brand-color");
    fireEvent.change(input, { target: { value: "#1f7a" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // ⭐ 反证锚点：不校验就提交 ⇒ 这里就会发出一个 `#1f7a` 的 PATCH（契约会拒，屏上报错）。
    expect(screen.getByTestId("design-detail-brand-invalid")).toHaveTextContent("#RRGGBB");
    expect(patches).toEqual([]);
    fireEvent.change(input, { target: { value: "#1f7aff" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(patches).toEqual([{ tokens: { brand: "#1F7AFF" } }]));
    await waitFor(() => expect(screen.getByTestId("design-detail-phone").getAttribute("data-brand")).toBe("#1F7AFF"));
  });

  it("用着品牌色时点强调色档位 = 换回档位：同一次请求里清掉品牌色", async () => {
    // ⭐ 反证锚点：点档位不清品牌色 ⇒ 品牌色压着，点了屏上什么都不变，这条红。
    const patches = mockServer({ tokens: { brand: "#FF5A1F", font: "sans" } });
    await openPanel();
    expect(screen.getByTestId("design-detail-accent-blue").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByTestId("design-detail-accent-rose"));
    await waitFor(() => expect(patches).toEqual([{ accent: "rose", tokens: { brand: null } }]));
    await waitFor(() => expect(screen.getByTestId("design-detail-phone").getAttribute("data-accent")).toBe("rose"));
  });

  it("字体：点「衬线」走 tokens.font，画布根换成衬线字体栈", async () => {
    const patches = mockServer();
    await openPanel();
    fireEvent.click(screen.getByTestId("design-detail-font-serif"));
    await waitFor(() => expect(patches).toEqual([{ tokens: { font: "serif" } }]));
    expect(screen.getByTestId("design-detail-font-serif").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("design-detail-phone").style.fontFamily).toContain("serif");
  });
});
