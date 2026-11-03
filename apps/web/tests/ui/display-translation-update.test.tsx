import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DisplayTranslationUpdate } from "@/components/localization/display-translation-update";
import { I18nProvider } from "@/lib/i18n/provider";
const mocks = vi.hoisted(() => ({ get: vi.fn(), apply: vi.fn(),
  session: { currentOrgId: "org-a", sessionToken: "token-a", userId: "user-a" }, identity: { orgRole: "admin" }, status: "authenticated" }));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ session: mocks.session, identity: mocks.identity, status: mocks.status }) }));
vi.mock("@/lib/authored-display-update", () => ({ getDisplayUpdateOffer: mocks.get, applyDisplayUpdate: mocks.apply }));
const result = { metadataVersion: "2.0.0", updatedEntities: 2, skippedEntities: 0, appliedAt: "2026-11-03T00:00:00.000Z", replayed: false };
function view(onUpdated = vi.fn()) { return <I18nProvider initialLocale="en"><DisplayTranslationUpdate canUpdate onUpdated={onUpdated} /></I18nProvider>; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.session = { currentOrgId: "org-a", sessionToken: "token-a", userId: "user-a" }; mocks.identity = { orgRole: "admin" }; mocks.status = "authenticated";
  mocks.get.mockResolvedValue({ metadataVersion: "2.0.0", available: true, installedCount: 2 }); mocks.apply.mockResolvedValue(result);
});
describe("explicit display translation update", () => {
  it("offers already installed content but writes only after an explicit click", async () => {
    const updated = vi.fn(); render(view(updated));
    const action = await screen.findByRole("button", { name: "Update display translations" });
    expect(mocks.apply).not.toHaveBeenCalled();
    fireEvent.click(action);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledWith("2.0.0",expect.any(String),expect.objectContaining({ orgId: "org-a", sessionToken: "token-a" })));
    expect(await screen.findByRole("status")).toHaveTextContent("Display translations updated");
    expect(updated).toHaveBeenCalledTimes(1);
  });
  it("does not fetch or mutate for a non-admin", async () => {
    mocks.identity = { orgRole: "consultant" }; render(view());
    await Promise.resolve(); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Update display translations" })).not.toBeInTheDocument();
  });
  it("reuses the attempt key after a network failure", async () => {
    mocks.apply.mockRejectedValueOnce(new Error("network")); render(view());
    fireEvent.click(await screen.findByRole("button", { name: "Update display translations" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Update display translations" }));
    await screen.findByText("Display translations updated.");
    expect(mocks.apply.mock.calls[0]![1]).toBe(mocks.apply.mock.calls[1]![1]);
  });
  it("ignores an old organization's completed request and binds subsequent writes to the new organization", async () => {
    let finish!: (value: typeof result) => void;
    mocks.apply.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const updated = vi.fn(), rendered = render(view(updated));
    fireEvent.click(await screen.findByRole("button", { name: "Update display translations" }));
    mocks.session = { ...mocks.session, currentOrgId: "org-b" }; rendered.rerender(view(updated));
    finish(result);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(updated).not.toHaveBeenCalled();
    expect(screen.queryByText("Display translations updated.")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Update display translations" }));
    await waitFor(() => expect(mocks.apply.mock.calls[1]![2]).toMatchObject({ orgId: "org-b" }));
  });
});
