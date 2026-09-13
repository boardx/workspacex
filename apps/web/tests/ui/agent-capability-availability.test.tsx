import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CapabilityCardList } from "@/components/chat/chat-task-workbench-capability-picker";
import type { CapabilityListing } from "@/lib/live-capabilities";

afterEach(cleanup);
it("keeps configured unavailable Agents visible but unselectable alongside ready Agents", () => {
  const select = vi.fn();
  const saved: CapabilityListing = { id: "saved", orgId: "org", kind: "agent", name: "Saved Agent", scope: "org-wide", enabled: true, endpoint: null, abbr: "SA", duty: "Assistant", disabledReason: "该 Agent 尚无可用的已发布版本，请联系管理员。", agentAvailable: false };
  render(<CapabilityCardList listings={[saved, { ...saved, id: "ready", name: "Ready Agent", agentAvailable: true, disabledReason: null }]} selectedAgentId={null} onSelect={select} />);
  const unavailable = screen.getByRole("option", { name: /Saved Agent/ });
  expect(unavailable).toBeDisabled();
  expect(unavailable).toHaveTextContent("尚无可用的已发布版本");
  fireEvent.click(unavailable);
  expect(select).not.toHaveBeenCalled();
  const ready = screen.getByRole("option", { name: /Ready Agent/ });
  expect(ready).toBeEnabled();
  fireEvent.click(ready);
  expect(select).toHaveBeenCalledWith("ready");
});
