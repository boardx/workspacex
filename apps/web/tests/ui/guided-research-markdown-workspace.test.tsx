import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuidedResearchMarkdownWorkspace } from "@/components/research-studio/guided-research-markdown-workspace";

const document = { node: "brief" as const, title: "研究需求", markdown: "# 研究需求\n\n## 研究主题\n新能源汽车", provenance: { sourceIds: [], citationIds: [] }, draft: { node: "brief" as const, value: { topic: "新能源汽车", goal: "比较市场", timeRange: "2026", region: "中国", focus: "竞争" } } };

describe("GuidedResearchMarkdownWorkspace", () => {
  it("opens the plan in preview and enters editing only on double click", () => {
    render(<GuidedResearchMarkdownWorkspace document={document} onSave={vi.fn()} editOnDoubleClick />);
    expect(screen.queryByTestId("guided-research-markdown-editor")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑 Markdown" })).not.toBeInTheDocument();
    fireEvent.doubleClick(screen.getByTestId("guided-research-markdown-preview"));
    expect(screen.getByTestId("guided-research-markdown-editor")).toBeInTheDocument();
  });
  it("asks before saving changed plan Markdown", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    render(<GuidedResearchMarkdownWorkspace document={document} onSave={onSave} editOnDoubleClick confirmChanges />);
    fireEvent.doubleClick(screen.getByTestId("guided-research-markdown-preview"));
    fireEvent.change(screen.getByTestId("guided-research-markdown-editor"), { target: { value: `${document.markdown}\nchanged` } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Markdown" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("确认修改研究计划");
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));
    expect(onSave).toHaveBeenCalledWith(`${document.markdown}\nchanged`);
  });
  it("reports local edits to the navigation guard and clears them on cancellation", () => {
    const dirty = vi.fn();
    render(<GuidedResearchMarkdownWorkspace document={document} onSave={vi.fn()} onDirtyChange={dirty} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑 Markdown" }));
    fireEvent.change(screen.getByTestId("guided-research-markdown-editor"), { target: { value: "未保存 Markdown" } });
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it("shows a preview first, preserves invalid local text, and reports successful saves", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, message: "缺少研究目标" }).mockResolvedValueOnce({ ok: false, message: "缺少研究目标" });
    render(<GuidedResearchMarkdownWorkspace document={document} onSave={onSave} />);

    expect(screen.getByTestId("guided-research-markdown-preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑 Markdown" }));
    const editor = screen.getByTestId("guided-research-markdown-editor");
    fireEvent.change(editor, { target: { value: "# 研究需求" } });
    expect(screen.getByTestId("guided-research-markdown-dirty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存 Markdown" }));

    expect(await screen.findByTestId("guided-research-markdown-error")).toHaveTextContent("缺少研究目标");
    expect(editor).toHaveValue("# 研究需求");
  });

  it("prevents duplicate saves while an async save is pending", () => {
    const onSave = vi.fn(() => new Promise<{ ok: boolean; message?: string }>(() => undefined));
    render(<GuidedResearchMarkdownWorkspace document={document} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑 Markdown" }));
    fireEvent.change(screen.getByTestId("guided-research-markdown-editor"), { target: { value: `${document.markdown}\n` } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Markdown" }));

    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("returns to preview with save feedback after a successful save", async () => {
    render(<GuidedResearchMarkdownWorkspace document={document} onSave={vi.fn().mockResolvedValue({ ok: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑 Markdown" }));
    fireEvent.change(screen.getByTestId("guided-research-markdown-editor"), { target: { value: `${document.markdown}\n` } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Markdown" }));

    expect(await screen.findByTestId("guided-research-markdown-saved")).toHaveTextContent("Markdown 已保存");
    expect(screen.getByTestId("guided-research-markdown-preview")).toBeInTheDocument();
  });
});
