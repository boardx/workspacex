import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PLATFORM_CATALOG_ORG_ID } from "@repo/contracts/ai-catalog-admin";
const mocks = vi.hoisted(() => ({
  allowed: true,
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  state: vi.fn(),
  organizations: vi.fn(),
  organization: vi.fn(),
  currentOrgId: "org-a",
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: mocks.currentOrgId, userId: "operator", sessionToken: "t" },
  }),
}));
vi.mock("@/lib/live-platform-access", () => ({
  usePlatformAccess: () => ({ platformOperator: mocks.allowed }),
}));
vi.mock("@/lib/live-platform-organizations", () => ({
  listPlatformOrganizations: mocks.organizations,
  getPlatformOrganization: mocks.organization,
}));
vi.mock("@/lib/ai-catalog-admin", () => ({
  listPlatformAiCatalog: mocks.list,
  getPlatformAiCatalogEntry: mocks.detail,
  createPlatformAiCatalogEntry: mocks.create,
  updatePlatformAiCatalogEntry: mocks.update,
  setPlatformAiCatalogState: mocks.state,
}));
import { PlatformAiCatalog } from "@/components/admin/platform-ai-catalog";
const row = {
  orgId: "org-b",
  kind: "agent" as const,
  id: "agent-other",
  versionId: null,
  name: "Other organization agent",
  description: "A concise description",
  avatarUrl: null,
  scope: "organization" as const,
  published: false,
  enabled: true,
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.currentOrgId = "org-a";
});
function setup() {
  mocks.organizations.mockResolvedValue({
    organizations: [{ orgId: "org-b", name: "Other organization" }],
    nextCursor: null,
  });
  mocks.list.mockResolvedValue({ entries: [row], nextCursor: null });
  mocks.organization.mockResolvedValue({ organization: { name: "Third organization" } });
}
it("shows the authored title and purpose for a platform Work Skill with generic metadata", async () => {
  setup();
  mocks.list.mockResolvedValue({
    entries: [{ ...row, kind: "skill", id: "skill-s020", orgId: PLATFORM_CATALOG_ORG_ID, name: "S020", workSkillId: "S020", description: "Skill" }],
    nextCursor: null,
  });
  render(<PlatformAiCatalog kind="skill" />);
  expect(await screen.findByText("高管简报成文")).toBeInTheDocument();
  expect(screen.getByText(/压成一份面向具体读者的简报正文/)).toBeInTheDocument();
  expect(screen.queryByText(/^Skill$/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "高管简报成文" } });
  expect(screen.getByText("高管简报成文")).toBeInTheDocument();
});

it("preserves an organization Skill name that coincides with a built-in identifier", async () => {
  setup();
  mocks.list.mockResolvedValue({
    entries: [{ ...row, kind: "skill", name: "S020", description: "租户自定义用途" }],
    nextCursor: null,
  });
  render(<PlatformAiCatalog kind="skill" />);
  expect(await screen.findByText("S020")).toBeInTheDocument();
  expect(screen.getByText("租户自定义用途")).toBeInTheDocument();
  expect(screen.queryByText("高管简报成文")).not.toBeInTheDocument();
});

describe("explicit platform capability target", () => {
  it("does not fetch platform data for nonoperators", () => {
    mocks.allowed = false;
    render(<PlatformAiCatalog kind="agent" />);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeTruthy();
  });
  it("disables creation for all organizations and creates public content under the public target", async () => {
    setup();
    mocks.create.mockResolvedValue({ ...row, orgId: PLATFORM_CATALOG_ORG_ID });
    render(<PlatformAiCatalog kind="agent" />);
    const create = screen.getByRole("button", {
      name: "新建",
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("管理范围"), { target: { value: "" } });
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("管理范围"), {
      target: { value: PLATFORM_CATALOG_ORG_ID },
    });
    await waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(
        "agent",
        PLATFORM_CATALOG_ORG_ID,
      ),
    );
    fireEvent.click(create);
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Public assistant" },
    });
    fireEvent.change(screen.getByLabelText("角色指令"), {
      target: { value: "Keep this role" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(PLATFORM_CATALOG_ORG_ID, {
        kind: "agent",
        input: {
          name: "Public assistant",
          description: "",
          instructions: "Keep this role",
          modelId: null,
        },
      }),
    );
  });
  it("loads and preserves the real definition when editing another organization", async () => {
    setup();
    mocks.detail.mockResolvedValue({
      entry: row,
      definition: {
        kind: "agent",
        input: {
          name: row.name,
          description: row.description,
          instructions: "Original instructions",
          modelId: "model-b",
        },
      },
    });
    mocks.update.mockResolvedValue(row);
    render(<PlatformAiCatalog kind="agent" />);
    fireEvent.click(await screen.findByText(row.name));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const field = (await screen.findByLabelText(
      "角色指令",
    )) as HTMLTextAreaElement;
    expect(field.value).toBe("Original instructions");
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(row, {
        kind: "agent",
        input: {
          name: "Updated",
          description: row.description,
          instructions: "Original instructions",
          modelId: "model-b",
        },
      }),
    );
  });
  it("keeps entity identifiers and administrative controls off the card face", async () => {
    setup();
    render(<PlatformAiCatalog kind="agent" />);
    await screen.findByText(row.name);
    const card = screen.getByTestId(`platform-agent-row-org-b:agent:${row.id}`);
    expect(within(card).queryByText(row.id)).toBeNull();
    expect(within(card).queryByRole("button", { name: "停用" })).toBeNull();
    fireEvent.click(card);
    expect(screen.getByRole("button", { name: "停用" })).toBeTruthy();
  });
});

it("shows legacy Skill contracts as explicitly read-only definitions", async () => {
  setup();
  const legacy = {
    ...row,
    kind: "skill",
    entityType: "skill-contract",
    id: "legacy-contract",
    name: "Legacy contract",
  };
  mocks.list.mockResolvedValue({ entries: [legacy], nextCursor: null });
  mocks.detail.mockResolvedValue({
    entry: legacy,
    definition: {
      kind: "skill-contract",
      input: {
        name: "Legacy contract",
        description: "Legacy instructions",
        source: "自建",
        status: "已启用",
        versionId: null,
        modelRef: null,
        declaration: null,
      },
    },
  });
  render(<PlatformAiCatalog kind="skill" />);
  fireEvent.click(await screen.findByText("Legacy contract"));
  expect(screen.queryByRole("button", { name: "发布" })).toBeNull();
  expect(screen.queryByRole("button", { name: "停用" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
  const editor = await screen.findByTestId("ai-catalog-editor");
  expect(within(editor).queryByRole("button", { name: "保存草稿" })).toBeNull();
  expect(within(editor).getByText("Legacy instructions")).toBeTruthy();
});

it("preserves the explicit organization target when organization search results change", async () => {
  setup();
  render(<PlatformAiCatalog kind="agent" />);
  await screen.findByRole("option", { name: "Other organization" });
  fireEvent.change(screen.getByLabelText("管理范围"), {
    target: { value: "org-b" },
  });
  mocks.organizations.mockResolvedValue({
    organizations: [{ orgId: "org-c", name: "Third organization" }],
    nextCursor: null,
  });
  fireEvent.change(screen.getByLabelText("搜索组织"), {
    target: { value: "Third" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await screen.findByRole("option", { name: "Third organization" });
  expect((screen.getByLabelText("管理范围") as HTMLSelectElement).value).toBe(
    "org-b",
  );
  expect(
    screen.getByRole("option", { name: "Other organization" }),
  ).toBeTruthy();
});

it("disables pending pagination, deduplicates rows and stops repeated cursors", async () => {
  setup();
  let finish!: (value: unknown) => void;
  mocks.list.mockResolvedValueOnce({ entries: [{ ...row, description: "agent" }], nextCursor: "page-2" })
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<PlatformAiCatalog kind="agent" />);
  const more = await screen.findByRole("button", { name: "加载更多" });
  expect(screen.queryByText("agent", { exact: true })).toBeNull();
  fireEvent.click(more);
  fireEvent.click(more);
  expect(more).toBeDisabled();
  expect(mocks.list).toHaveBeenCalledTimes(2);
  finish({ entries: [row], nextCursor: "page-2" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull());
  expect(screen.getAllByText(row.name)).toHaveLength(1);
});

it.each(["agent", "skill"] as const)(
  "defaults to the current organization and groups paginated %s entries by ownership",
  async (kind) => {
    setup();
    const publicRow = { ...row, kind, orgId: PLATFORM_CATALOG_ORG_ID, name: "Shared name" };
    const other = { ...publicRow, orgId: "org-b" };
    const third = { ...publicRow, orgId: "org-c" };
    mocks.list.mockImplementation(async (_kind, orgId, cursor) => ({
      entries: orgId ? [{ ...row, kind, orgId, name: "Current content" }]
        : cursor ? [publicRow, other, other, third] : [publicRow],
      nextCursor: !orgId && !cursor ? "page-2" : null,
    }));
    const view = render(<PlatformAiCatalog kind={kind} />);
    const scope = screen.getByRole("combobox", { name: "管理范围" });
    expect(scope).toHaveValue("org-a");
    await screen.findByText("Current content");
    expect(mocks.list).toHaveBeenCalledWith(kind, "org-a");

    fireEvent.change(scope, { target: { value: "" } });
    expect(screen.queryByText("Current content")).not.toBeInTheDocument();
    const publicGroup = await screen.findByRole("region", { name: /平台公共/ });
    fireEvent.click(await screen.findByRole("button", { name: "加载更多" }));
    const otherGroup = await screen.findByRole("region", { name: "Other organization" });
    const thirdGroup = await screen.findByRole("region", { name: "Third organization" });
    expect(within(publicGroup).getAllByText("Shared name")).toHaveLength(1);
    expect(within(otherGroup).getAllByText("Shared name")).toHaveLength(1);
    expect(within(thirdGroup).getAllByText("Shared name")).toHaveLength(1);
    expect(mocks.organization).toHaveBeenCalledWith("org-c");
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();

    mocks.currentOrgId = "org-b";
    view.rerender(<PlatformAiCatalog kind={kind} />);
    expect(screen.getByRole("combobox", { name: "管理范围" })).toHaveValue("org-b");
    await screen.findByText("Current content");
    expect(mocks.list).toHaveBeenLastCalledWith(kind, "org-b");
  },
);
