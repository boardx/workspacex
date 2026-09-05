/**
 * F10（#2719）—— 前端产出物面板（`ArtifactsPanel`,
 * `components/agent-kernel/agent-kernel-units.tsx`）。
 *
 * `requirements/04-artifacts-steering.md` R8：侧栏 artifacts 面板展示当前产出物的版本
 * 历史缩略图，无产出物时显示空态；用户可在版本历史中切换查看任一版本，可
 * 「查看此版本」或「基于此继续修改」发起迭代。
 *
 * 依据等级：[原型]（ui-prototyper 已在签核阶段建成，含空态——
 * `contracts/artifacts-steering/ui.md` S1/S2）。本次补的是把这份
 * user_visible_behavior 固化成会红的回归门控，覆盖 feature_list.json 本条 notes
 * 逐字列出的断言面：data-testid=artifacts-panel、版本切换
 * artifact-version-1/2/3（aria-pressed 切换）、artifact-view/artifact-continue
 * 存在、空态 empty。
 *
 * 范围说明：F09 目前只有应用层用例与存储实现，尚未暴露 HTTP 控制器，
 * `continueArtifact` 的 `ArtifactRunLauncher` 也明确声明未接生产实现
 * （`application/artifacts-steering/ports.ts`）——接真实数据是后续 feature 的范围，
 * 不在本条 notes 的断言面内，因此本测试仍基于 `MOCK_ARTIFACT` 驱动组件。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArtifactsPanel } from "@/components/agent-kernel/agent-kernel-units";
import { MOCK_ARTIFACT } from "@/lib/mock/agent-kernel";

describe("ArtifactsPanel 空态：无产出物时显示空态", () => {
  it("data-testid=artifacts-panel 存在，且内含 empty 空态节点", () => {
    render(<ArtifactsPanel empty />);
    expect(screen.getByTestId("artifacts-panel")).toBeInTheDocument();
    expect(screen.getByTestId("empty")).toBeInTheDocument();
  });

  it("空态下不渲染版本历史或任何 artifact-version-* 按钮", () => {
    render(<ArtifactsPanel empty />);
    expect(screen.queryByTestId(/^artifact-version-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("artifact-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("artifact-continue")).not.toBeInTheDocument();
  });
});

describe("ArtifactsPanel 有版本：版本历史缩略图列表", () => {
  it("data-testid=artifacts-panel 存在，MOCK_ARTIFACT 的每个版本都有对应 artifact-version-{n}", () => {
    render(<ArtifactsPanel />);
    expect(screen.getByTestId("artifacts-panel")).toBeInTheDocument();
    for (const v of MOCK_ARTIFACT.versions) {
      expect(screen.getByTestId(`artifact-version-${v.version}`)).toBeInTheDocument();
    }
  });

  it("最新版本默认选中（aria-pressed=true），其余版本 aria-pressed=false", () => {
    render(<ArtifactsPanel />);
    const latest = MOCK_ARTIFACT.versions[0]!;
    expect(screen.getByTestId(`artifact-version-${latest.version}`)).toHaveAttribute("aria-pressed", "true");
    for (const v of MOCK_ARTIFACT.versions.slice(1)) {
      expect(screen.getByTestId(`artifact-version-${v.version}`)).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("点击某个非当前版本，切换该版本的 aria-pressed=true，原当前版本切回 false", () => {
    render(<ArtifactsPanel />);
    const latest = MOCK_ARTIFACT.versions[0]!;
    const older = MOCK_ARTIFACT.versions[MOCK_ARTIFACT.versions.length - 1]!;
    const olderBtn = screen.getByTestId(`artifact-version-${older.version}`);

    fireEvent.click(olderBtn);

    expect(olderBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId(`artifact-version-${latest.version}`)).toHaveAttribute("aria-pressed", "false");
  });

  it("切换版本后，预览区文本反映所选版本（不是仅切换按钮状态、预览原地不动）", () => {
    render(<ArtifactsPanel />);
    const older = MOCK_ARTIFACT.versions[MOCK_ARTIFACT.versions.length - 1]!;

    fireEvent.click(screen.getByTestId(`artifact-version-${older.version}`));

    const preview = screen.getByTestId("artifact-preview");
    expect(preview).toHaveTextContent(older.label);
    expect(preview.textContent).toContain(String(older.sizeKb));
  });

  it("『查看此版本』『基于此继续修改』均存在、是按钮、未被禁用", () => {
    render(<ArtifactsPanel />);
    const viewBtn = screen.getByTestId("artifact-view");
    const continueBtn = screen.getByTestId("artifact-continue");
    expect(viewBtn.tagName).toBe("BUTTON");
    expect(continueBtn.tagName).toBe("BUTTON");
    expect(viewBtn).toBeEnabled();
    expect(continueBtn).toBeEnabled();
  });
});
