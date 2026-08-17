/**
 * #848 —— skill 的编辑页面要有「左文件树 + 右代码」的内容面板，不能只有
 * 「名称/可见范围/归属团队」三个字段。`AgSkillEditor`（`asset-governance/ag-screens.tsx`）
 * 早就写好了，但只挂在孤立的 `/asset-governance` 原型路由下，一直用写死的示例 skill
 * （`AG_SKILL_MAIN.slug`），不接调用方传入的 `assetId`。
 *
 * 人类反馈（2026-08-17）：点击「编辑」现在打开独立页面（`CapabilityEditPage`），
 * 不再是列表页里内联展开——本文件因此改成直接渲染 `CapabilityEditPage`，
 * 而不是经由 `SkillScreen`/`AgentScreen` 点一次「编辑」再点一次面板开关
 * （那个开关已经随整页跳转一起删掉：一整页本来就是为了编辑这一个 skill，
 * 没有理由默认收起它）。
 *
 * 本文件断言的是**接线**本身，不是 `AgSkillEditor` 内部的读写逻辑——那部分已经在
 * `apps/web/tests/ui/asset-file-edit-save.test.tsx` 覆盖过。这里要证明的是：
 *
 * ① 编辑页对真实后端发起的是**这一行 skill 自己的** `assetId`（`row.id`），不是
 *    `AgSkillEditor` 内部那个写死的示例 slug——这是最容易假成功的地方
 *    （如果没接对，`getAssetDirectory` 会打成 `"mece-decomposition"`）。
 * ② `kind === "agent"` 的编辑页不出现这个面板——后端对 `agent` 仍是
 *    `FixtureAssetFileRepository`（#787 未解决），接了会显示假数据。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";

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

import { CapabilityEditPage } from "@/components/admin/capability-edit-page";
import { SkillContentEditorSection } from "@/components/admin/skill-content-editor";

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

describe("F848 · 独立编辑页面接真实后端的内容面板", () => {
  it("编辑页加载后：getAssetDirectory / readAssetFile 打的是这一行真实的 assetId（row.id），不是写死的示例 slug", async () => {
    listCapabilities.mockResolvedValue([SKILL_ROW]);
    render(
      <CapabilityEditPage
        kind="skill"
        id={SKILL_ROW.id}
        renderEditExtra={(row) => <SkillContentEditorSection id={`admin-skill-row-${row.id}`} row={row} />}
      />,
    );

    await waitFor(() => expect(getAssetDirectory).toHaveBeenCalledTimes(1));
    expect(getAssetDirectory).toHaveBeenCalledWith("skill", SKILL_ROW.id);
    expect(getAssetDirectory).not.toHaveBeenCalledWith("skill", "mece-decomposition");

    await waitFor(() => expect(readAssetFile).toHaveBeenCalledWith("skill", SKILL_ROW.id, "SKILL.md"));

    // 展示的是这行真实 skill 的名字，不是 `AgSkillEditor` 内部写死的示例名字。
    expect(await screen.findAllByText(SKILL_ROW.name)).not.toHaveLength(0);
  });

  it("改动内容并保存：writeAssetFile 带的是这一行真实的 assetId 与改后的正文", async () => {
    listCapabilities.mockResolvedValue([SKILL_ROW]);
    render(
      <CapabilityEditPage
        kind="skill"
        id={SKILL_ROW.id}
        renderEditExtra={(row) => <SkillContentEditorSection id={`admin-skill-row-${row.id}`} row={row} />}
      />,
    );

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

  it("kind === agent 的编辑页不出现内容面板——后端对 agent 仍是 fixture，接了会显示假数据", async () => {
    listCapabilities.mockResolvedValue([AGENT_ROW]);
    render(<CapabilityEditPage kind="agent" id={AGENT_ROW.id} />);

    // 三字段表单本身还在（保存按钮存在），但没有内容面板。
    expect(await screen.findByTestId(`admin-agent-row-${AGENT_ROW.id}-save`)).toBeInTheDocument();
    expect(screen.queryByTestId(`admin-agent-row-${AGENT_ROW.id}-content-editor`)).toBeNull();
    expect(getAssetDirectory).toHaveBeenCalledTimes(0);
  });
});
