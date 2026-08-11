/**
 * #848 —— `/admin/skill` 的编辑入口原来只有「名称/可见范围/归属团队」三个字段，
 * 没有文件树 / 代码编辑。两栏「左文件树 + 右代码」的 `AgSkillEditor` 早就写好了
 * （`asset-governance/ag-screens.tsx`），但只挂在孤立的 `/asset-governance` 原型
 * 路由下，且一直用写死的示例 skill（`AG_SKILL_MAIN.slug`），不接调用方传入的
 * `assetId`。
 *
 * 本文件断言的是**接线**本身，不是 `AgSkillEditor` 内部的读写逻辑——那部分已经在
 * `apps/web/tests/ui/asset-file-edit-save.test.tsx` 覆盖过。这里要证明的是：
 *
 * ① `/admin/skill` 点「编辑」后能展开出内容面板，且面板对真实后端发起的是
 *    **这一行 skill 自己的** `assetId`（`row.id`），不是 `AgSkillEditor` 内部那个
 *    写死的示例 slug——这是本次改动唯一的行为变化点，也是最容易假成功的地方
 *    （如果没接对，`getAssetDirectory` 会打成 `"mece-decomposition"`）。
 * ② 面板默认收起，不在挂载时就发起网络请求——避免对着「用户可能根本不点开」的
 *    面板打真实接口。
 * ③ `kind === "agent"` 的编辑表单不出现这个面板——后端对 `agent` 仍是
 *    `FixtureAssetFileRepository`（#787 未解决），接了会显示假数据。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup, waitFor, within } from "@testing-library/react";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-848", orgRole: "admin" }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: "真实组织" },
      orgRole: sessionState.orgRole,
    },
  }),
}));

const { listCapabilities } = vi.hoisted(() => ({ listCapabilities: vi.fn() }));
vi.mock("@/lib/live-capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-capabilities")>()),
  listCapabilities,
}));

const { getAssetDirectory, readAssetFile, writeAssetFile, getStoredSessionToken } = vi.hoisted(() => ({
  getAssetDirectory: vi.fn(),
  readAssetFile: vi.fn(),
  writeAssetFile: vi.fn(),
  getStoredSessionToken: vi.fn(),
}));
vi.mock("@/lib/asset-directory", () => ({ getAssetDirectory, readAssetFile, writeAssetFile }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  getStoredSessionToken,
}));

import { SkillScreen } from "@/components/admin/skill-screen";
import { AgentScreen } from "@/components/admin/agent-screen";

const SKILL_ROW = {
  id: "sk_real_848",
  orgId: sessionState.currentOrgId,
  kind: "skill" as const,
  name: "真实 Skill 848",
  scope: "org-wide" as const,
  enabled: true,
  endpoint: null,
  disabledReason: null,
};

const AGENT_ROW = {
  id: "agent_848",
  orgId: sessionState.currentOrgId,
  kind: "agent" as const,
  name: "真实 Agent 848",
  scope: "org-wide" as const,
  enabled: true,
  endpoint: null,
  disabledReason: null,
};

const SERVER_BODY = "---\nname: 真实 Skill 848\n---\n正文\n";

beforeEach(() => {
  vi.clearAllMocks();
  getStoredSessionToken.mockReturnValue("token-848");
  readAssetFile.mockResolvedValue({ body: SERVER_BODY, sizeBytes: 42 });
  writeAssetFile.mockResolvedValue({ sizeBytes: 99, dirty: true });
  getAssetDirectory.mockResolvedValue({
    files: [{ path: "SKILL.md", sizeBytes: 42, badge: "MD" }],
  });
});

afterEach(() => cleanup());

describe("F848 · /admin/skill 编辑入口能展开出接真实后端的内容面板", () => {
  it("点编辑 → 点「查看/编辑源码」之前：不发起任何目录请求（面板默认收起）", async () => {
    listCapabilities.mockResolvedValue([SKILL_ROW]);
    render(<SkillScreen state="default" />);

    const row = await screen.findByTestId(`admin-skill-row-${SKILL_ROW.id}`);
    fireEvent.click(within(row).getByTestId(`admin-skill-row-${SKILL_ROW.id}-edit`));

    const toggle = await screen.findByTestId(`admin-skill-row-${SKILL_ROW.id}-content-toggle`);
    expect(toggle.textContent).toContain("查看 / 编辑源码");
    // 装置自检：面板还没展开，getAssetDirectory 一次都不该被调用。
    expect(getAssetDirectory).toHaveBeenCalledTimes(0);
  });

  it("展开面板：getAssetDirectory / readAssetFile 打的是这一行真实的 assetId（row.id），不是写死的示例 slug", async () => {
    listCapabilities.mockResolvedValue([SKILL_ROW]);
    render(<SkillScreen state="default" />);

    const row = await screen.findByTestId(`admin-skill-row-${SKILL_ROW.id}`);
    fireEvent.click(within(row).getByTestId(`admin-skill-row-${SKILL_ROW.id}-edit`));
    fireEvent.click(await screen.findByTestId(`admin-skill-row-${SKILL_ROW.id}-content-toggle`));

    await waitFor(() => expect(getAssetDirectory).toHaveBeenCalledTimes(1));
    expect(getAssetDirectory).toHaveBeenCalledWith("skill", SKILL_ROW.id);
    expect(getAssetDirectory).not.toHaveBeenCalledWith("skill", "mece-decomposition");

    await waitFor(() => expect(readAssetFile).toHaveBeenCalledWith("skill", SKILL_ROW.id, "SKILL.md"));

    // 展示的是这行真实 skill 的名字，不是 `AgSkillEditor` 内部写死的示例名字。
    expect(await screen.findAllByText(SKILL_ROW.name)).not.toHaveLength(0);
  });

  it("改动内容并保存：writeAssetFile 带的是这一行真实的 assetId 与改后的正文", async () => {
    listCapabilities.mockResolvedValue([SKILL_ROW]);
    render(<SkillScreen state="default" />);

    const row = await screen.findByTestId(`admin-skill-row-${SKILL_ROW.id}`);
    fireEvent.click(within(row).getByTestId(`admin-skill-row-${SKILL_ROW.id}-edit`));
    fireEvent.click(await screen.findByTestId(`admin-skill-row-${SKILL_ROW.id}-content-toggle`));

    await waitFor(() => {
      const el = screen.getByTestId("ag-skill-code");
      expect(el.tagName).toBe("TEXTAREA");
    });
    const codeBox = () => screen.getByTestId("ag-skill-code") as HTMLTextAreaElement;
    await waitFor(() => expect(codeBox().value).toBe(SERVER_BODY));

    const EDITED = SERVER_BODY + "改过一行\n";
    fireEvent.change(codeBox(), { target: { value: EDITED } });
    fireEvent.click(screen.getByTestId("ag-skill-publish-trigger"));
    fireEvent.click(screen.getByTestId("ag-skill-publish-confirm"));

    await waitFor(() => expect(writeAssetFile).toHaveBeenCalledTimes(1));
    expect(writeAssetFile).toHaveBeenCalledWith("skill", SKILL_ROW.id, "SKILL.md", EDITED);
  });

  it("kind === agent 的编辑表单不出现内容面板——后端对 agent 仍是 fixture，接了会显示假数据", async () => {
    listCapabilities.mockResolvedValue([AGENT_ROW]);
    render(<AgentScreen state="default" />);

    const row = await screen.findByTestId(`admin-agent-row-${AGENT_ROW.id}`);
    fireEvent.click(within(row).getByTestId(`admin-agent-row-${AGENT_ROW.id}-edit`));

    // 三字段表单本身还在（保存按钮存在），但没有内容面板的开关。
    expect(await screen.findByTestId(`admin-agent-row-${AGENT_ROW.id}-save`)).toBeInTheDocument();
    expect(screen.queryByTestId(`admin-agent-row-${AGENT_ROW.id}-content-toggle`)).toBeNull();
    expect(getAssetDirectory).toHaveBeenCalledTimes(0);
  });
});
