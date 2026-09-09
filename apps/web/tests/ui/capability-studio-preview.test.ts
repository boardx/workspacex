import { describe, expect, it } from "vitest";
import { initialStudioPreview, studioReducer, trialIsCurrent, validPreviewPath, StudioPreviewSchema } from "../../components/ai-capability-studio/preview-model";

describe("capability studio preview version boundaries", () => {
  it("restores serializable draft edits without trusting broken browser-storage references", () => {
    const dirty = studioReducer(initialStudioPreview(), { type: "edit", content: "recover this edit" });
    const restored = StudioPreviewSchema.parse(JSON.parse(JSON.stringify(dirty)));
    expect(studioReducer(initialStudioPreview(), { type: "restore", state: restored })).toEqual(dirty);
    expect(StudioPreviewSchema.safeParse({ ...dirty, selected: "missing.py" }).success).toBe(false);
    expect(StudioPreviewSchema.safeParse({ ...dirty, files: [] }).success).toBe(false);
  });
  it("saving several files never publishes or moves the Agent binding", () => {
    let state = initialStudioPreview();
    const published = state.releases;
    state = studioReducer(state, { type: "edit", content: "updated instructions" });
    state = studioReducer(state, { type: "select", path: "scripts/build_brief.py" });
    state = studioReducer(state, { type: "edit", content: "print('updated')" });
    state = studioReducer(state, { type: "save" });
    expect(state.revision).toBe(4);
    expect(state.dirty).toBe(false);
    expect(state.releases).toBe(published);
    expect(state.boundRelease).toBe(1);
    expect(state.files.filter(file => file.content.includes("updated"))).toHaveLength(2);
  });
  it("editing or changing dependencies makes old trial evidence unusable", () => {
    const tested = studioReducer(initialStudioPreview(), { type: "trial", passed: true, sampleInput: "sample task" });
    expect(trialIsCurrent(tested)).toBe(true);
    for (const action of [{ type: "edit", content: "changed" }, { type: "model" }, { type: "tool" }, { type: "test-input", value: "different sample" }] as const) {
      const changed = studioReducer(tested, action);
      expect(trialIsCurrent(changed)).toBe(false);
      expect(studioReducer(changed, { type: "publish" }).releases).toHaveLength(1);
    }
  });
  it("a failed or unsaved trial cannot enable publishing", () => {
    const failed = studioReducer(initialStudioPreview(), { type: "trial", passed: false, sampleInput: "sample task" });
    expect(trialIsCurrent(failed)).toBe(false);
    const dirty = studioReducer(failed, { type: "edit", content: "pending change" });
    expect(studioReducer(dirty, { type: "trial", passed: true, sampleInput: "sample task" })).toBe(dirty);
  });
  it("publish creates one immutable snapshot; binding is a separate explicit action", () => {
    const tested = studioReducer(initialStudioPreview(), { type: "trial", passed: true, sampleInput: "sample task" });
    const published = studioReducer(tested, { type: "publish" });
    expect(published.releases).toHaveLength(2);
    expect(published.boundRelease).toBe(1);
    expect(studioReducer(published, { type: "publish" })).toBe(published);
    const changed = studioReducer(published, { type: "edit", content: "later draft" });
    expect(changed.releases[1]!.files[0]!.content).not.toBe("later draft");
    expect(studioReducer(changed, { type: "bind", release: 2 }).boundRelease).toBe(2);
    expect(studioReducer(changed, { type: "bind", release: 99 })).toBe(changed);
  });
  it("upstream merge and rollback only change working files", () => {
    const initial = initialStudioPreview();
    const merged = studioReducer(initial, { type: "upstream" });
    expect(merged.dirty).toBe(true);
    expect(merged.releases).toBe(initial.releases);
    const restored = studioReducer(merged, { type: "rollback", release: 1 });
    expect(restored.files).toEqual(initial.releases[0]!.files);
    expect(restored.files).not.toBe(initial.releases[0]!.files);
    expect(restored.boundRelease).toBe(1);
  });
  it("AI instruction suggestions target the manifest even when a script is selected", () => {
    const initial = initialStudioPreview();
    const selected = studioReducer(initial, { type: "select", path: "scripts/build_brief.py" });
    const changed = studioReducer(selected, { type: "ai-instructions" });
    expect(changed.selected).toBe("SKILL.md");
    expect(changed.files.find(file => file.path === "scripts/build_brief.py")).toEqual(selected.files.find(file => file.path === "scripts/build_brief.py"));
    expect(changed.files[0]!.content).toContain("输出前逐条核对来源");
    expect(changed.releases).toBe(initial.releases);
  });
  it("file operations reject unsafe or occupied paths and protect SKILL.md", () => {
    const initial = initialStudioPreview();
    for (const path of ["../secret", "/etc/config", "a/../b", "a\\b", "", "a//b"]) {
      expect(validPreviewPath(path)).toBe(false);
      expect(studioReducer(initial, { type: "create", path })).toBe(initial);
    }
    expect(studioReducer(initial, { type: "delete" })).toBe(initial);
    const created = studioReducer(initial, { type: "create", path: "scripts/check.py" });
    expect(created.selected).toBe("scripts/check.py");
    expect(studioReducer(created, { type: "rename", path: "SKILL.md" })).toBe(created);
    expect(studioReducer(created, { type: "delete" }).files).toEqual(initial.files);
  });
});
