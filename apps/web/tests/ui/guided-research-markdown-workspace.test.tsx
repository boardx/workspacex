import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuidedResearchMarkdownWorkspace } from "@/components/research-studio/guided-research-markdown-workspace";

const document = { node: "brief" as const, title: "研究需求", markdown: "# 研究需求\n\n## 研究主题\n新能源汽车", provenance: { sourceIds: [], citationIds: [] } };

describe("GuidedResearchMarkdownWorkspace", () => {
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
