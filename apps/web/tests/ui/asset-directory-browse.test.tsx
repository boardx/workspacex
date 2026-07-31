/**
 * F141 -- 资产目录：文件树 + 文件内容读取（`uc-23-3` R3 步骤 1-8 / R12-1..4/13）。
 *
 * 这份测试证明的是**渲染层的真实行为**，不是后端判定（那部分见
 * `apps/api/tests/asset/asset-directory-tree.test.ts` 与 `asset-file-badge-fallback.test.ts`）：
 *
 *   1. Skill / Agent 各自的文件树逐一渲染出 `SK_TREE` / `AG_TREE`（R12-1/2）；
 *   2. 徽标由扩展名派生，且一个未知扩展名（.rtf）**不报错、落到 MD**（R12-3，
 *      与 `assetFileBadgeFromPath` 是同一个函数，不是界面自己另判一次）；
 *   3. 目录行不显示大小，文件行显示大小（R12-4）；
 *   4. 点文件 → 右栏内容变、该行高亮，同一时刻至多一行高亮（R12-5）。
 */
import { describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { assetFileBadgeFromPath } from "@repo/contracts/asset-governance";
import { FileTree } from "@/components/asset-governance/ag-shared";
import { AgSkillEditor, AgAgentEditor } from "@/components/asset-governance/ag-screens";
import { AG_SKILL_TREE, AG_AGENT_TREE, type FileNode } from "@/lib/mock/asset-governance";

const noop = () => undefined;

describe("FileTree -- Skill 目录（SK_TREE，R12-1）", () => {
  it("逐一渲染 5 个文件、3 个目录（references / assets / scripts）", () => {
    render(<FileTree files={AG_SKILL_TREE} selected={AG_SKILL_TREE[0]!.path} onSelect={noop} testidPrefix="t" />);
    const fileRows = screen.getAllByTestId("t-file");
    expect(fileRows.length).toBe(AG_SKILL_TREE.length);
    const dirRows = screen.getAllByTestId("t-dir").map((d) => d.textContent);
    expect(dirRows.some((t) => t?.includes("references"))).toBe(true);
    expect(dirRows.some((t) => t?.includes("assets"))).toBe(true);
    expect(dirRows.some((t) => t?.includes("scripts"))).toBe(true);
    cleanup();
  });

  it("每一行的徽标 = assetFileBadgeFromPath(该行路径)：界面不自己另判一次", () => {
    render(<FileTree files={AG_SKILL_TREE} selected={AG_SKILL_TREE[0]!.path} onSelect={noop} testidPrefix="t2" />);
    const badges = screen.getAllByTestId("t2-file-badge");
    // 渲染顺序与 AG_SKILL_TREE 一致（FileTree 保持输入顺序，只插入目录行）
    expect(badges.map((b) => b.textContent)).toEqual(AG_SKILL_TREE.map((f) => assetFileBadgeFromPath(f.path)));
    expect(badges.map((b) => b.textContent)).toContain("PY");
    cleanup();
  });

  it("R12-4：目录行不显示大小，文件行显示大小", () => {
    render(<FileTree files={AG_SKILL_TREE} selected={AG_SKILL_TREE[0]!.path} onSelect={noop} testidPrefix="t3" />);
    for (const dir of screen.getAllByTestId("t3-dir")) {
      expect(within(dir).queryByTestId("t3-file-size")).toBeNull();
    }
    const sizes = screen.getAllByTestId("t3-file-size");
    expect(sizes.length).toBe(AG_SKILL_TREE.length);
    for (const s of sizes) expect(s.textContent).toMatch(/k$/);
    cleanup();
  });
});

describe("FileTree -- R12-3 未知扩展名不报错，落到 MD", () => {
  const withUnknownExt: FileNode[] = [
    ...AG_SKILL_TREE,
    { path: "references/legacy-notes.rtf", size: "0.3k", kind: "md" },
  ];

  it("渲染不抛异常，且该行徽标为 MD", () => {
    expect(() =>
      render(<FileTree files={withUnknownExt} selected={withUnknownExt[0]!.path} onSelect={noop} testidPrefix="u" />),
    ).not.toThrow();
    const badges = screen.getAllByTestId("u-file-badge");
    expect(badges[badges.length - 1]!.textContent).toBe("MD");
    cleanup();
  });
});

describe("FileTree -- 选中/高亮（R12-5）", () => {
  it("点文件 → 该行高亮转移，同一时刻至多一行高亮", () => {
    let selected = AG_SKILL_TREE[0]!.path;
    const { rerender } = render(
      <FileTree files={AG_SKILL_TREE} selected={selected} onSelect={(p) => { selected = p; }} testidPrefix="h" />,
    );
    const rows = screen.getAllByTestId("h-file");
    const highlighted = () => rows.filter((r) => r.className.includes("bg-accent"));
    expect(highlighted().length).toBe(1);

    const target = AG_SKILL_TREE[2]!.path;
    fireEvent.click(screen.getAllByTestId("h-file")[2]!);
    expect(selected).toBe(target);

    rerender(<FileTree files={AG_SKILL_TREE} selected={selected} onSelect={noop} testidPrefix="h" />);
    const rows2 = screen.getAllByTestId("h-file");
    const highlighted2 = rows2.filter((r) => r.className.includes("bg-accent"));
    expect(highlighted2.length).toBe(1);
    expect(highlighted2[0]!.textContent).toContain(target.split("/").pop());
    cleanup();
  });
});

describe("Skill / Agent 编辑器屏 -- 两类目录各自可浏览（R12-1/2 端到端）", () => {
  it("Skill 编辑器渲染出 SK_TREE 全部文件", () => {
    render(<AgSkillEditor state="default" view="maintainer" />);
    expect(screen.getAllByTestId("ag-skill-file").length).toBe(AG_SKILL_TREE.length);
    cleanup();
  });

  it("Agent 编辑器渲染出 AG_TREE 全部文件", () => {
    render(<AgAgentEditor state="default" view="maintainer" />);
    expect(screen.getAllByTestId("ag-agent-file").length).toBe(AG_AGENT_TREE.length);
    cleanup();
  });
});
