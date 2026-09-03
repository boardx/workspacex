/**
 * #1971 —— 人类截图实测反馈（2026-08-24）：`/admin/skill/[id]` 点开一个 skill
 * 卡片后进入的编辑页要变成全屏专注编辑模式，并且把顶部信息（返回链接/标题/id/
 * 名称·可见范围表单/说明文字）压缩成小字一行，把空间让给文件树 + 代码编辑器。
 *
 * 两层证据：
 *  ① 结构层——`app/platform-admin/skill/[id]/page.tsx`（2026-09-02 自 `app/admin/skill/[id]` 搬入）真的用了 `AppShell` 的 `hideTopBar`
 *     沉浸式模式、且不再渲染 `AdminNav`（否则「全屏」只是嘴上说说，左栏和顶栏
 *     chrome 还在）。
 *  ② 行为层——`CapabilityEditPage` 在 `compact` 下渲染的是压缩头部
 *     （`admin-skill-edit-compact-header`），不是旧版大标题 `<h1>`；
 *     `SkillContentEditorSection` 的说明文字收进默认折叠的 `<details>`；
 *     内容编辑器（`AgSkillEditor`）仍然真实接线到这一行的 `assetId`。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("@monaco-editor/react", () => import("@/tests/support/monaco-editor-stub"));

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-1971", orgRole: "admin" }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: { org: { id: sessionState.currentOrgId, name: "真实组织" }, orgRole: sessionState.orgRole },
  }),
}));

const { listCapabilities } = vi.hoisted(() => ({ listCapabilities: vi.fn() }));
vi.mock("@/lib/live-capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-capabilities")>()),
  listCapabilities,
}));

const { getAssetDirectory, readAssetFile, getStoredSessionToken } = vi.hoisted(() => ({
  getAssetDirectory: vi.fn(),
  readAssetFile: vi.fn(),
  getStoredSessionToken: vi.fn(),
}));
vi.mock("@/lib/asset-directory", () => ({ getAssetDirectory, readAssetFile, writeAssetFile: vi.fn() }));
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  getStoredSessionToken,
}));

import { CapabilityEditPage } from "@/components/admin/capability-edit-page";
import { SkillContentEditorSection } from "@/components/admin/skill-content-editor";

const SKILL_ROW = {
  id: "sk_1971",
  orgId: sessionState.currentOrgId,
  kind: "skill" as const,
  name: "全屏编辑测试 Skill",
  scope: "org-wide" as const,
  enabled: true,
  endpoint: null,
  disabledReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getStoredSessionToken.mockReturnValue("token-1971");
  readAssetFile.mockResolvedValue({ body: "---\nname: 全屏编辑测试 Skill\n---\n正文\n", sizeBytes: 10 });
  getAssetDirectory.mockResolvedValue({ files: [{ path: "SKILL.md", sizeBytes: 10, badge: "MD" }] });
  listCapabilities.mockResolvedValue([SKILL_ROW]);
});

afterEach(() => cleanup());

describe("F1971 · ① 结构层——/admin/skill/[id] 页面源码真的走全屏模式", () => {
  it("`hideTopBar` 存在、不渲染 `AdminNav`（没有 `left=` prop），且把 compact 传给 CapabilityEditPage", () => {
    const source = readFileSync(
      resolve(__dirname, "../../app/platform-admin/skill/[id]/page.tsx"),
      "utf8",
    );
    expect(source).toMatch(/<AppShell[^>]*\bhideTopBar\b/);
    // 允许头注里用文字提到 AdminNav（解释为什么不用它），但不能有 import 语句
    // 或 JSX 标签——那才是「真的还挂着左栏」。
    expect(source).not.toMatch(/import\s*\{[^}]*\bAdminNav\b/);
    expect(source).not.toMatch(/<AdminNav\b/);
    expect(source).not.toMatch(/left=\{/);
    expect(source).toMatch(/<CapabilityEditPage[\s\S]*?\bcompact\b/);
  });
});

describe("F1971 · ② 行为层——CapabilityEditPage compact 布局真的压缩了头部", () => {
  it("compact=true：渲染压缩头部（`-compact-header`），不渲染旧版独立大标题区块", async () => {
    render(
      <CapabilityEditPage
        kind="skill"
        id={SKILL_ROW.id}
        compact
        renderEditExtra={(row) => <SkillContentEditorSection id={`admin-skill-row-${row.id}`} row={row} />}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("admin-skill-edit-compact-header")).toBeInTheDocument();
    });
    // 压缩头部里仍能看到名称与 id（只是不再是独立的 <h1> 区块）。
    expect(screen.getAllByText(SKILL_ROW.name).length).toBeGreaterThan(0);
    expect(screen.getAllByText(SKILL_ROW.id).length).toBeGreaterThan(0);

    // 内容编辑器仍然真实接线到这一行的 assetId（compact 不影响接线，只影响布局）。
    await waitFor(() => expect(getAssetDirectory).toHaveBeenCalledWith("skill", SKILL_ROW.id));
  });

  it("compact=false（agent 走的默认路径）：仍然是旧版布局，没有压缩头部 testid", async () => {
    const AGENT_ROW = { ...SKILL_ROW, id: "agent_1971", kind: "agent" as const };
    listCapabilities.mockResolvedValue([AGENT_ROW]);
    render(<CapabilityEditPage kind="agent" id={AGENT_ROW.id} />);

    await waitFor(() => {
      expect(screen.getByTestId(`admin-agent-row-${AGENT_ROW.id}-save`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("admin-agent-edit-compact-header")).toBeNull();
  });

  it("SkillContentEditorSection：说明文字收进默认折叠的 <details>，标题仍可见", async () => {
    render(
      <CapabilityEditPage
        kind="skill"
        id={SKILL_ROW.id}
        compact
        renderEditExtra={(row) => <SkillContentEditorSection id={`admin-skill-row-${row.id}`} row={row} />}
      />,
    );
    const hint = await screen.findByTestId(`admin-skill-row-${SKILL_ROW.id}-content-hint`);
    expect(hint.tagName).toBe("DETAILS");
    // 默认折叠——原生 <details> 未显式 open 属性时 .open 为 false。
    expect((hint as HTMLDetailsElement).open).toBe(false);
  });
});
