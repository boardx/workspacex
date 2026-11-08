import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AiCatalogPage } from "@/lib/ai-catalog-admin";
const state = vi.hoisted(() => ({
  org: "org-a",
  role: "admin",
  list: vi.fn(),
  enable: vi.fn(),
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: state.org, userId: "u", sessionToken: "t" },
    identity: { orgRole: state.role },
  }),
}));
vi.mock("@/lib/ai-catalog-admin", () => ({
  listPublicAiCatalog: state.list,
  enablePublicAiCatalog: state.enable,
}));
import { PublicAiCatalog } from "@/components/admin/public-ai-catalog";
const page = (name = "Public agent", enabled = false): AiCatalogPage => ({
  entries: [
    {
      orgId: "org-platform",
      kind: "agent",
      id: "a",
      versionId: "v1",
      name,
      description: "Short description",
      avatarUrl: null,
      scope: "public",
      published: true,
      enabled,
    },
  ],
  nextCursor: null,
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.org = "org-a";
  state.role = "admin";
});
describe("public capability enablement", () => {
  it("keeps card minimal and enables the selected exact version only from details", async () => {
    state.list.mockResolvedValue(page());
    state.enable.mockResolvedValue({
      id: "local",
      versionId: "lv",
      kind: "agent",
      originId: "a",
      originVersionId: "v1",
    });
    render(<PublicAiCatalog kind="agent" />);
    fireEvent.click(await screen.findByText("Public agent"));
    fireEvent.click(screen.getByRole("button", { name: "为本组织启用" }));
    await waitFor(() =>
      expect(state.enable).toHaveBeenCalledWith(
        "org-a",
        expect.objectContaining({ id: "a", versionId: "v1" }),
        expect.any(String),
      ),
    );
  });
  it("lets members browse without an enable action", async () => {
    state.role = "consultant";
    state.list.mockResolvedValue(page());
    render(<PublicAiCatalog kind="agent" />);
    fireEvent.click(await screen.findByText("Public agent"));
    expect(screen.queryByRole("button", { name: "为本组织启用" })).toBeNull();
    expect(screen.getByText("请联系组织管理员启用")).toBeTruthy();
  });
  it("rejects late results after the organization changes", async () => {
    let resolve!: (p: AiCatalogPage) => void;
    state.list
      .mockImplementationOnce(
        () => new Promise<AiCatalogPage>((r) => (resolve = r)),
      )
      .mockResolvedValue(page("New organization"));
    const view = render(<PublicAiCatalog kind="agent" />);
    state.org = "org-b";
    view.rerender(<PublicAiCatalog kind="agent" />);
    await screen.findByText("New organization");
    await act(async () => resolve(page("Old organization")));
    expect(screen.queryByText("Old organization")).toBeNull();
  });
});
