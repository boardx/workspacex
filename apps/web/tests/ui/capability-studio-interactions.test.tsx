import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CapabilityStudioPreview } from "@/components/ai-capability-studio/workbench-preview";
import { CapabilityImportPreview } from "@/components/ai-capability-studio/import-preview";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

beforeEach(() => { sessionStorage.clear(); navigation.push.mockClear(); });
const click = (id: string) => fireEvent.click(screen.getByTestId(id));

describe("capability preview rendered interaction boundaries", () => {
  it("cannot restart a failed item while confirming the next import batch", () => {
    render(<CapabilityImportPreview />);
    click("import-inspect"); click("import-candidate-research-brief"); click("import-candidate-meeting-notes");
    click("import-submit-batch"); click("import-partial"); click("import-new-batch");
    expect(screen.getByTestId("import-retry")).toBeDisabled();
    click("import-retry");
    expect(screen.getByTestId("import-result-meeting-notes")).toHaveTextContent("第 1 次尝试");
    fireEvent.click(screen.getByRole("button", { name: "继续查看当前结果" }));
    click("import-retry");
    expect(screen.getByTestId("import-result-meeting-notes")).toHaveTextContent("第 2 次尝试");
    expect(screen.queryByTestId("import-confirm-new")).toBeNull();
    expect(screen.getByTestId("import-url")).toBeDisabled();
  });
  it("starts another import explicitly while preserving terminal batch results", () => {
    render(<CapabilityImportPreview />);
    click("import-inspect"); click("import-candidate-research-brief"); click("import-submit-batch");
    expect(screen.queryByTestId("import-new-batch")).toBeNull();
    click("import-complete"); click("import-new-batch");
    expect(screen.getByTestId("import-url")).toBeDisabled();
    click("import-confirm-new");
    expect(screen.getByTestId("import-url")).toBeEnabled();
    expect(screen.getByTestId("import-history")).toHaveTextContent("draft-research-brief");
    expect(screen.queryByTestId("import-batch")).toBeNull();
    click("import-inspect");
    expect(screen.getByTestId("import-submit-batch")).toBeDisabled();
  });
  it("recovers the imported source together with the draft after remount", () => {
    const first = render(<CapabilityStudioPreview state="default" />);
    click("studio-import");
    fireEvent.change(screen.getByTestId("studio-source"), { target: { value: "https://github.com/another/skill" } });
    click("studio-preview-source"); click("studio-confirm-import");
    first.unmount();
    render(<CapabilityStudioPreview state="default" />);
    fireEvent.click(screen.getByRole("button", { name: "来源与更新" }));
    expect(screen.getByTestId("studio-upstream-panel")).toHaveTextContent("https://github.com/another/skill");
  });
  it("carries the selected historical release into the binding confirmation", () => {
    render(<CapabilityStudioPreview state="default" />);
    click("studio-open-tests"); click("studio-run-pass"); click("studio-publish"); click("studio-confirm-publish");
    click("studio-bind-2"); click("studio-confirm-bind"); click("studio-modal-close");
    expect(screen.getByTestId("studio-version-status")).toHaveTextContent("Agent 固定 v2");
    click("studio-bind-1");
    expect(screen.getByTestId("studio-confirm-bind")).toHaveTextContent("确认绑定 v1");
    click("studio-confirm-bind"); click("studio-modal-close");
    expect(screen.getByTestId("studio-version-status")).toHaveTextContent("Agent 固定 v1");
  });

  it("changing the test input invalidates publication while retaining the actual tested input", () => {
    render(<CapabilityStudioPreview state="default" />);
    click("studio-open-tests");
    fireEvent.change(screen.getByTestId("studio-test-input"), { target: { value: "original trial input" } });
    click("studio-run-pass");
    expect(screen.getByTestId("studio-publish")).toBeEnabled();
    fireEvent.change(screen.getByTestId("studio-test-input"), { target: { value: "different trial input" } });
    expect(screen.getByTestId("studio-publish")).toBeDisabled();
    expect(screen.getByTestId("studio-trial-result")).toHaveTextContent("结果已过期");
    expect(screen.getByTestId("studio-trial-input")).toHaveTextContent("original trial input");
  });

  it("keeps edits after cancelling navigation and restores them on route remount", () => {
    const first = render(<CapabilityStudioPreview state="default" />);
    fireEvent.change(screen.getByTestId("studio-file-content"), { target: { value: "recover my pending edits" } });
    click("studio-full-import"); click("studio-stay");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("studio-file-content")).toHaveValue("recover my pending edits");
    first.unmount();
    // Exercises route lifecycle recovery, not the browser's native history UI.
    render(<CapabilityStudioPreview state="default" />);
    expect(screen.getByTestId("studio-file-content")).toHaveValue("recover my pending edits");
    expect(screen.getByTestId("studio-notice")).toHaveTextContent("已恢复");
  });

  it("locks the source after partial completion and retries only the failed item", () => {
    render(<CapabilityImportPreview />);
    click("import-inspect"); click("import-candidate-research-brief"); click("import-candidate-meeting-notes");
    click("import-submit-batch"); click("import-partial");
    expect(screen.getByTestId("import-url")).toBeDisabled();
    expect(screen.getByTestId("import-ref")).toBeDisabled();
    expect(screen.getByTestId("import-kind-zip")).toBeDisabled();
    click("import-retry");
    expect(screen.getByTestId("import-result-research-brief")).toHaveTextContent("第 1 次尝试");
    expect(screen.getByTestId("import-result-research-brief")).toHaveTextContent("draft-research-brief");
    expect(screen.getByTestId("import-result-meeting-notes")).toHaveTextContent("第 2 次尝试");
  });

  it("does not present a GitHub single-file URL as a complete package in the quick demo", () => {
    render(<CapabilityStudioPreview state="default" />);
    click("studio-import");
    fireEvent.change(screen.getByTestId("studio-source"), { target: { value: "https://github.com/example/skills/blob/main/SKILL.md" } });
    click("studio-preview-source");
    expect(screen.getByTestId("studio-form-error")).toHaveTextContent("完整导入向导");
    expect(screen.queryByTestId("studio-import-preview")).toBeNull();
    expect(screen.getByTestId("studio-confirm-import")).toBeDisabled();
  });
});
