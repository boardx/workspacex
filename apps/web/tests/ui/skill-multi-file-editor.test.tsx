import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillMultiFileEditor } from "@/components/admin/skill-multi-file-editor";
import { ApiError } from "@/lib/api-client";
const mocks = vi.hoisted(() => ({ directory: vi.fn(), snapshot: vi.fn(), save: vi.fn(), trial: vi.fn(), poll: vi.fn() }));
vi.mock("@/lib/asset-directory", () => ({ getAssetDirectory: mocks.directory }));
vi.mock("@/lib/live-skill-files", () => ({ getSkillFileSnapshot: mocks.snapshot, saveSkillFiles: mocks.save }));
vi.mock("@/lib/skill-trial-run", () => ({ runSkillTrialRun: mocks.trial, pollSkillTrialRun: mocks.poll }));
const file = (path: string, text: string) => ({ path, contentBase64: btoa(text), mediaType: "text/plain", sizeBytes: text.length });
const baseline = { skillId: "skill-real", versionId: "version-1", semanticLabel: "v1", contentDigest: "a".repeat(64), createdAt: "2026-09-10T00:00:00Z", readOnly: false, files: [file("SKILL.md", "original instructions"), file("references/old.txt", "old notes")] };
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const edit = (text: string) => fireEvent.change(screen.getByRole("textbox", { name: "文件内容" }), { target: { value: text } });
const consent = () => fireEvent.click(screen.getByRole("checkbox", { name: "确认统一保存全部修改并发布新版本" }));
const ready = async () => { render(<SkillMultiFileEditor skillId="skill-real" />); await screen.findByRole("textbox", { name: "文件内容" }); };
beforeEach(() => { vi.clearAllMocks(); mocks.directory.mockResolvedValue({ currentVersionId: "version-1" }); mocks.snapshot.mockResolvedValue(baseline); });
describe("real Skill multi-file editor", () => {
  it("loads the exact returned version and sends one atomic batch for added, edited and deleted files", async () => {
    await ready(); expect(mocks.snapshot).toHaveBeenCalledWith("skill-real", "version-1");
    edit("changed instructions"); click("references/old.txt");
    fireEvent.click(screen.getByRole("checkbox", { name: /确认从下一版本删除/ })); click("删除所选文件");
    fireEvent.change(screen.getByLabelText("新文件路径"), { target: { value: "scripts/new.py" } }); click("新建文件"); edit("print(42)");
    expect(mocks.save).not.toHaveBeenCalled();
    const updated = { ...baseline, versionId: "version-2", semanticLabel: "v2", files: [file("SKILL.md", "changed instructions"), file("scripts/new.py", "print(42)")] };
    mocks.save.mockResolvedValue(updated); consent(); click("保存全部文件并发布");
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledWith("skill-real", "version-1", [
      { kind: "delete", path: "references/old.txt" },
      { kind: "put", path: "SKILL.md", contentBase64: btoa("changed instructions"), mediaType: "text/plain" },
      { kind: "put", path: "scripts/new.py", contentBase64: btoa("print(42)"), mediaType: "text/plain" },
    ]);
    await waitFor(() => expect(screen.getByTestId("skill-file-version")).toHaveTextContent("version-2"));
    expect(screen.queryByRole("button", { name: "references/old.txt" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存全部文件并发布" })).toBeDisabled();
  });
  it("preserves all edited files and version after a conflict and requires explicit discard before reloading", async () => {
    await ready(); edit("unsaved main"); click("references/old.txt"); edit("unsaved notes");
    mocks.save.mockRejectedValue(new ApiError(409, "EDIT_VERSION_CONFLICT", "Concurrent version change")); consent(); click("保存全部文件并发布");
    await screen.findByRole("alert"); expect(screen.getByRole("textbox", { name: "文件内容" })).toHaveValue("unsaved notes"); click("SKILL.md");
    expect(screen.getByRole("textbox", { name: "文件内容" })).toHaveValue("unsaved main");
    expect(screen.getByTestId("skill-file-version")).toHaveTextContent("version-1");
    expect(screen.getByRole("button", { name: "读取最新版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "放弃本页未保存修改" })); click("读取最新版本");
    await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "文件内容" })).toHaveValue("original instructions"));
  });
  it("runs the newly saved version and blocks running unsaved edits", async () => {
    await ready(); edit("new instructions"); fireEvent.change(screen.getByRole("textbox", { name: "试跑输入", hidden: true }), { target: { value: "sample" } });
    expect(screen.getByRole("button", { name: "试跑已保存版本", hidden: true })).toBeDisabled();
    mocks.save.mockResolvedValue({ ...baseline, versionId: "version-2", semanticLabel: "v2", files: [file("SKILL.md", "new instructions"), baseline.files[1]] });
    consent(); click("保存全部文件并发布"); await waitFor(() => expect(screen.getByTestId("skill-file-version")).toHaveTextContent("version-2"));
    mocks.trial.mockResolvedValue({ trialRun: null, asyncTaskId: "trial-1" }); mocks.poll.mockResolvedValue({ status: "succeeded", trialRun: { versionId: "version-2", output: "real output" }, failure: null });
    fireEvent.click(screen.getByText("试跑当前已保存版本")); click("试跑已保存版本");
    await waitFor(() => expect(mocks.trial).toHaveBeenCalledWith("version-2", "sample"));
    expect(await screen.findByTestId("skill-file-trial-result")).toHaveTextContent("real output");
  });
  it("does not apply an old save response after switching to another Skill", async () => {
    let complete!: (value: typeof baseline) => void;
    mocks.save.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const view = render(<SkillMultiFileEditor skillId="skill-real" />);
    await screen.findByRole("textbox", { name: "文件内容" }); edit("old Skill edit"); consent(); click("保存全部文件并发布");
    const other = { ...baseline, skillId: "skill-other", versionId: "other-version", files: [file("SKILL.md", "other Skill content")] };
    mocks.directory.mockResolvedValue({ currentVersionId: other.versionId }); mocks.snapshot.mockResolvedValue(other);
    view.rerender(<SkillMultiFileEditor skillId="skill-other" />);
    await waitFor(() => expect(screen.getByTestId("skill-file-version")).toHaveTextContent("other-version"));
    await act(async () => { complete({ ...baseline, versionId: "late-old-version" }); });
    expect(screen.getByTestId("skill-file-version")).toHaveTextContent("other-version");
    expect(screen.getByRole("textbox", { name: "文件内容" })).toHaveValue("other Skill content");
  });
  it("prompts before leaving through a real page navigation link with unsaved files", async () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<><a href="/skill">Skill directory</a><SkillMultiFileEditor skillId="skill-real" /></>);
      await screen.findByRole("textbox", { name: "文件内容" }); edit("keep my edits");
      expect(fireEvent.click(screen.getByRole("link", { name: "Skill directory" }))).toBe(false);
      expect(ask).toHaveBeenCalledOnce(); expect(screen.getByRole("textbox", { name: "文件内容" })).toHaveValue("keep my edits");
    } finally { ask.mockRestore(); }
  });
  it("rejects duplicate and unsafe paths, protects root and invalidates publication consent on edits", async () => {
    await ready(); expect(screen.queryByRole("button", { name: "删除所选文件" })).not.toBeInTheDocument();
    for (const path of ["SKILL.md", "../outside.py"]) { fireEvent.change(screen.getByLabelText("新文件路径"), { target: { value: path } }); click("新建文件"); expect(screen.getByRole("alert")).toHaveTextContent("路径无效或已存在"); }
    edit("pending"); consent(); edit("changed again"); expect(screen.getByRole("checkbox", { name: /确认统一保存/ })).not.toBeChecked();
  });
  it("never substitutes sample files on read failure and honors read-only snapshots", async () => {
    mocks.snapshot.mockRejectedValueOnce(new Error("Access denied")); render(<SkillMultiFileEditor skillId="skill-real" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Access denied"); expect(screen.queryByRole("textbox", { name: "文件内容" })).not.toBeInTheDocument();
    mocks.snapshot.mockResolvedValue({ ...baseline, readOnly: true }); click("重新读取");
    expect(await screen.findByRole("textbox", { name: "文件内容" })).toBeDisabled(); expect(screen.getByRole("button", { name: "新建文件" })).toBeDisabled();
  });
});
