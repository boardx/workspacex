import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentIdentityRow } from "@/components/chat/copilotkit-v2-agent-identity";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { AgentDirectoryCard } from "@/lib/agent-directory";
import { resetAgentDirectoryMapCache } from "@/lib/use-agent-directory-map";
const official: AgentDirectoryCard = {
  agentId: "10000000-0000-4000-8000-000000000001", versionId: "20000000-0000-4000-8000-000000000001",
  name: "Sales Representative", initials: "S", roleLabel: "Sales Representative",
  avatar: { kind: "illustration", key: "dh-05-sales-representative", alt: "" }, roleCategory: "sales",
  tags: [], catalogSource: "official", workflows: [], readiness: "ready",
};
function SwitchLanguage() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale("zh-CN")}>switch language</button>;
}
afterEach(() => resetAgentDirectoryMapCache());
it("uses an approved official author name in the current locale while preserving the source identity", async () => {
  const directory = vi.fn(async () => [official]);
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><AgentIdentityRow agentId={official.agentId} fetchDirectory={directory} /></I18nProvider>);
  await waitFor(() => expect(screen.getByTestId("chat-v2-agent-identity").textContent).toBe("Sales Representative"));
  expect(screen.getByTestId("chat-v2-agent-portrait").getAttribute("data-avatar-key")).toBe(official.avatar?.key);
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  await waitFor(() => expect(screen.getByTestId("chat-v2-agent-identity").textContent).toBe("销售代表"));
  // The existing reviewed-entity catalog intentionally has separate locale cache keys.
  expect(directory.mock.calls).toEqual([[{ locale: "en" }], [{ locale: "zh-CN" }]]);
  expect(official.name).toBe("Sales Representative");
  expect(official.agentId).toBe("10000000-0000-4000-8000-000000000001");
});
it("preserves an organization author's mixed-language name even with an official-looking avatar", async () => {
  const custom: AgentDirectoryCard = { ...official, catalogSource: "org", name: "用户原名 {count} 🌍" };
  const directory = vi.fn(async () => [custom]);
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><AgentIdentityRow agentId={custom.agentId} fetchDirectory={directory} /></I18nProvider>);
  await waitFor(() => expect(screen.getByTestId("chat-v2-agent-identity").textContent).toBe(custom.name));
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  await waitFor(() => expect(screen.getByTestId("chat-v2-agent-identity").textContent).toBe(custom.name));
});
it("localizes the generic author label in place without loading an agent catalog", () => {
  const directory = vi.fn(async () => [official]);
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><AgentIdentityRow agentId={null} fetchDirectory={directory} /></I18nProvider>);
  const identity = screen.getByTestId("chat-v2-agent-identity");
  const label = screen.getByText("AI assistant");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-v2-agent-identity")).toBe(identity);
  expect(screen.getByText("AI 助手")).toBe(label);
  expect(directory).not.toHaveBeenCalled();
});
