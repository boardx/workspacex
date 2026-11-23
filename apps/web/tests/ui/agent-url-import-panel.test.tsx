import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AgentUrlImportPanel } from "@/components/admin/agent-url-import-panel";
import { importAgentFromUrl } from "@/lib/agent-url-import";

vi.mock("@/lib/agent-url-import", () => ({ importAgentFromUrl: vi.fn() }));

it("shows the imported draft after React StrictMode replays mount effects", async () => {
  vi.mocked(importAgentFromUrl).mockResolvedValue({
    agentId: "agent-imported",
    name: "Imported agent",
    publishState: "草稿",
    instructions: "Summarize a test scenario.",
    contentDigest: "0".repeat(64),
    replayed: false,
  });

  render(<React.StrictMode><AgentUrlImportPanel /></React.StrictMode>);
  fireEvent.change(screen.getByTestId("agent-url-import-url"), { target: { value: "https://example.com/agent.md" } });
  fireEvent.change(screen.getByTestId("agent-url-import-name"), { target: { value: "Imported agent" } });
  fireEvent.click(screen.getByTestId("agent-url-import-confirm"));

  expect(await screen.findByTestId("agent-url-import-post-panel")).toBeVisible();
  expect(screen.getByTestId("agent-url-import-instructions")).toHaveValue("Summarize a test scenario.");
});
