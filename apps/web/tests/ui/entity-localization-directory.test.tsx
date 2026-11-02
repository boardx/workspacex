import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentDirectory } from "@/components/agent/agent-directory";
import { AgentDetail } from "@/components/agent/agent-detail";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { agentRole } from "@repo/contracts";
import { resolveEntityDisplay } from "@repo/contracts/entity-localization";

function LanguageButton() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("en")}>Switch English</button>; }
const original = agentRole.AgentDirectoryCard.parse({ agentId: "agent-a", versionId: "v1", name: "原名", initials: "原", roleLabel: "原头衔", avatar: { kind: "illustration", key: "robot", alt: "原头像" }, roleCategory: "research", tags: [], catalogSource: "org", workflows: [], readiness: "unknown" });
const display = resolveEntityDisplay({ orgId: "org", entityId: "agent-a", kind: "agent", revision: "r1", versionId: "v1", locale: "zh-CN", fields: { name: "原名", roleLabel: "原头衔" } }, "en", {
  orgId: "org", entityId: "agent-a", kind: "agent", sourceRevision: "r1", locale: "en", revision: 1, status: "reviewed", fields: { name: "Translated agent", roleLabel: "Translated role", avatarAlt: "Research agent portrait" },
});
describe("directory locale-aware content", () => {
  it("uses reviewed avatar alternatives in the detail portrait and visible handoff targets", async () => {
    render(<I18nProvider initialLocale="en"><AgentDetail agentId={original.agentId} onStartChat={vi.fn()}
      fetchCard={vi.fn().mockResolvedValue({ ...original, display })}
      fetchExtras={vi.fn().mockResolvedValue({ duty: null, skillSource: "agent", skills: [], delegationTargets: [{ ...original, display }], requireApprovalForHandoff: true })} /></I18nProvider>);
    await waitFor(() => expect(screen.getByTestId("agent-detail-portrait")).toHaveAttribute("aria-label", "Research agent portrait"));
    expect(screen.getByTestId("agent-detail-handoff-target").querySelector("[role=img]")).toHaveAttribute("aria-label", "Research agent portrait");
  });
  it("refetches on language switch and renders translated copy without changing original IDs", async () => {
    const fetchDirectory = vi.fn(async (filters: { locale?: string }) => filters.locale === "en" ? [{ ...original, display }] : [original]);
    render(<I18nProvider initialLocale="zh-CN"><LanguageButton /><AgentDirectory fetchDirectory={fetchDirectory} /></I18nProvider>);
    expect(await screen.findByText("原名")).toBeVisible();
    expect(screen.getByTestId("agent-card-avatar")).toHaveAttribute("aria-label", "头像 robot");
    fireEvent.click(screen.getByRole("button", { name: "Switch English" }));
    expect(await screen.findByText("Translated agent")).toBeVisible();
    expect(screen.getByText("Translated role")).toBeVisible();
    expect(screen.getByTestId("agent-card-avatar")).toHaveAttribute("aria-label", "Research agent portrait");
    await waitFor(() => expect(fetchDirectory).toHaveBeenLastCalledWith(expect.objectContaining({ locale: "en" })));
    expect(original.name).toBe("原名"); expect(original.agentId).toBe("agent-a"); expect(original.versionId).toBe("v1");
  });
});
