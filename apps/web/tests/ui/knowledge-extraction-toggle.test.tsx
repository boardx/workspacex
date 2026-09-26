/**
 * issue #4178 / #4247 —— 组织后台「对话记忆」开关（`knowledge-extraction-toggle.tsx`）。
 *
 * #4247 关注的是 `deploymentCapable=false`：整个部署没开（平台管理员关了部署级总闸，或没配
 * 抽取模型）时，组织开关必须明说「部署没有开启」、禁用、标「未生效」——不能看起来开着、
 * 可点却不起作用。只 mock `apiRequest` 这一层。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequest(...a) };
});

import { KnowledgeExtractionToggleSection } from "@/components/org-admin/knowledge-extraction-toggle";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("组织级记忆抽取开关", () => {
  it("deploymentCapable=false：说明部署没有开启、开关禁用、点了不发请求", async () => {
    apiRequest.mockResolvedValue({ deploymentCapable: false, orgEnabled: true });
    render(<KnowledgeExtractionToggleSection isAdmin />);
    const note = await screen.findByTestId("knowledge-extraction-not-capable");
    expect(note.textContent).toContain("这个部署没有开启记忆抽取");
    expect(note.textContent).toContain("未生效");
    const sw = screen.getByRole("switch");
    expect(sw.hasAttribute("disabled")).toBe(true);
    fireEvent.click(sw);
    expect(apiRequest).toHaveBeenCalledTimes(1); // 只有那一次 GET
  });

  it("deploymentCapable=true 且是 admin：开关可切，不显示部署未开启说明", async () => {
    apiRequest.mockImplementation(async (_p: string, opts?: { method?: string }) =>
      opts?.method === "PUT" ? { deploymentCapable: true, orgEnabled: false } : { deploymentCapable: true, orgEnabled: true });
    render(<KnowledgeExtractionToggleSection isAdmin />);
    const sw = await screen.findByRole("switch");
    expect(screen.queryByTestId("knowledge-extraction-not-capable")).toBeNull();
    expect(sw.hasAttribute("disabled")).toBe(false);
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false"));
  });
});
