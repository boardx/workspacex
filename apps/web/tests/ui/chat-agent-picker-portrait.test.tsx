/**
 * dh-* 数字人头像：composer 的「运行 Agent」选人器（`AgentPicker`）按 id 从成员目录取
 * `avatar.key`，有就画插画、没有回退首字母。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { listAgentDirectory } = vi.hoisted(() => ({ listAgentDirectory: vi.fn() }));
vi.mock("@/lib/agent-directory", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listAgentDirectory,
}));

import { AgentPicker } from "@/components/chat/chat-composer-pickers";
import { resetAgentDirectoryMapCache } from "@/lib/use-agent-directory-map";

afterEach(() => { cleanup(); vi.clearAllMocks(); resetAgentDirectoryMapCache(); });

const agents = [
  { id: "a1", abbr: "XS", name: "小销", duty: "销售", roleLabel: "销售", presence: "present" as const },
  { id: "a2", abbr: "NO", name: "无头像", duty: "x", roleLabel: "x", presence: "present" as const },
];

describe("AgentPicker portrait", () => {
  it("选中的与候选项都显示 dh-* 头像；目录里没有的回退首字母", async () => {
    listAgentDirectory.mockResolvedValue([{
      agentId: "a1", versionId: "v1", name: "小销", initials: "销", roleLabel: "销售代表",
      avatar: { kind: "illustration", key: "dh-05-sales-representative", alt: "小销" },
      roleCategory: "sales", tags: [], catalogSource: "official", workflows: [], readiness: "ready",
    }]);
    render(<AgentPicker agents={agents} selectedAgentId="a1" disabled={false} onSelect={vi.fn()} />);
    const trigger = screen.getByTestId("chat-agent-select");
    await waitFor(() => expect(trigger.querySelector("[data-avatar-key]")?.getAttribute("data-avatar-key")).toBe("dh-05-sales-representative"));
    fireEvent.click(trigger);
    expect(screen.getByTestId("chat-agent-select-option-a1").querySelector("[data-avatar-key]")).not.toBeNull();
    const fallback = screen.getByTestId("chat-agent-select-option-a2");
    expect(fallback.querySelector("[data-avatar-key]")).toBeNull();
    expect(fallback.textContent).toContain("NO");
  });

  it("目录读失败 → 全部回退首字母，不报错", async () => {
    listAgentDirectory.mockRejectedValue(new Error("down"));
    render(<AgentPicker agents={agents} selectedAgentId="a1" disabled={false} onSelect={vi.fn()} />);
    await waitFor(() => expect(listAgentDirectory).toHaveBeenCalled());
    expect(screen.getByTestId("chat-agent-select").querySelector("[data-avatar-key]")).toBeNull();
    expect(screen.getByTestId("chat-agent-select").textContent).toContain("XS");
  });
});
