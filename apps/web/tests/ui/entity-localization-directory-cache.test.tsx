import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { agentRole } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { useAgentDirectoryMap, resetAgentDirectoryMapCache } from "@/lib/use-agent-directory-map";
import { ENTITY_LOCALIZATION_UPDATED } from "@/lib/entity-localization";
const session = vi.hoisted(() => ({ value: null as null | { status: string; session: { userId: string; currentOrgId: string }; identity: { orgRole: string; org: { team: string } } } }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => session.value }));
function card(name: string) { return agentRole.AgentDirectoryCard.parse({ agentId: "a", versionId: "v1", name, initials: "A", roleLabel: "", avatar: null, roleCategory: null, tags: [], catalogSource: "org", workflows: [], readiness: "unknown" }); }
function Switch() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("en")}>English</button>; }
function Consumer({ fetchDirectory, id }: { fetchDirectory: (filters?: { locale?: string }) => Promise<readonly ReturnType<typeof card>[]>; id: string }) {
  const map = useAgentDirectoryMap(true, fetchDirectory);
  return <span data-testid={id}>{map.get("a")?.name ?? "pending"}</span>;
}
beforeEach(() => { resetAgentDirectoryMapCache(); session.value = null; });
describe("directory cache locale and session isolation", () => {
  it("shares a request within a locale but reloads once after switching languages", async () => {
    const fetchDirectory = vi.fn(async (filters?: { locale?: string }) => [card(filters?.locale === "en" ? "English" : "中文")]);
    render(<I18nProvider initialLocale="zh-CN"><Switch /><Consumer id="one" fetchDirectory={fetchDirectory} /><Consumer id="two" fetchDirectory={fetchDirectory} /></I18nProvider>);
    await waitFor(() => expect(screen.getByTestId("one")).toHaveTextContent("中文"));
    expect(fetchDirectory).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(screen.getByTestId("two")).toHaveTextContent("English"));
    expect(fetchDirectory).toHaveBeenCalledTimes(2);
  });
  it("does not reuse or paint another session's completed/in-flight directory", async () => {
    session.value = { status: "authenticated", session: { userId: "actor-a", currentOrgId: "org-a" }, identity: { orgRole: "admin", org: { team: "A" } } };
    let resolveOld!: (cards: readonly ReturnType<typeof card>[]) => void;
    const fetchDirectory = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue([card("组织B")]);
    const tree = () => <I18nProvider initialLocale="zh-CN"><Consumer id="one" fetchDirectory={fetchDirectory} /></I18nProvider>;
    const rendered = render(tree());
    await waitFor(() => expect(fetchDirectory).toHaveBeenCalledTimes(1));
    session.value = { status: "authenticated", session: { userId: "actor-b", currentOrgId: "org-b" }, identity: { orgRole: "admin", org: { team: "B" } } };
    rendered.rerender(tree());
    await waitFor(() => expect(screen.getByTestId("one")).toHaveTextContent("组织B"));
    resolveOld([card("组织A")]);
    await waitFor(() => expect(screen.getByTestId("one")).not.toHaveTextContent("组织A"));
  });
  it("invalidates once after an authoring change and ignores the old in-flight result", async () => {
    let resolveOld!: (cards: readonly ReturnType<typeof card>[]) => void;
    const fetchDirectory = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue([card("最新译名")]);
    render(<I18nProvider initialLocale="zh-CN"><Consumer id="one" fetchDirectory={fetchDirectory} /><Consumer id="two" fetchDirectory={fetchDirectory} /></I18nProvider>);
    await waitFor(() => expect(fetchDirectory).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new CustomEvent(ENTITY_LOCALIZATION_UPDATED, { detail: { kind: "agent", entityId: "a" } }));
    await waitFor(() => expect(screen.getByTestId("two")).toHaveTextContent("最新译名"));
    expect(fetchDirectory).toHaveBeenCalledTimes(2);
    resolveOld([card("旧译名")]);
    await waitFor(() => expect(screen.getByTestId("one")).not.toHaveTextContent("旧译名"));
  });
});
