import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AidtReportPreview } from "@/features/aidt/components/aidt-report-preview";
import { useAidtReportReview, type AidtReportReviewView } from "@/features/aidt/lib/use-aidt-report-review";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtSharedReportController } from "@/features/aidt/lib/use-aidt-shared-stages";

type Reference = { stageId: number; revision: number };
const manuscript = "# 小组报告\n尚未真实测试，不把合成材料当用户证据。";
function Owner({ host = "preparing", scope = "org-a/user-a/session-a/project-a/report-a", revision = 1, markdown = manuscript,
  sources = [{ stageId: 1, revision: 1 }], selectedSources = sources, canConfirm = true, confirm, expose }: {
  host?: string; scope?: string; revision?: number; markdown?: string; sources?: Reference[]; selectedSources?: Reference[];
  canConfirm?: boolean; confirm: () => Promise<void>; expose?: (value: AidtReportReviewView) => void;
}) {
  const view = useAidtReportReview({ scope, serverRevision: revision, markdown, sources, selectedSources, canConfirm });
  React.useEffect(() => { expose?.(view); });
  const shared: AidtSharedReportController = { available: true, loading: false, saving: false, canSave: false,
    serverRevision: revision, serverMarkdown: markdown, savedAt: "2026-11-21T00:00:00Z", savedBy: "synthetic-student",
    matchesServer: true, conflict: false, needsBaseReview: false, error: null, loadError: null,
    save: vi.fn().mockResolvedValue(undefined), reload: vi.fn(), restore: vi.fn(), reviewBase: vi.fn(),
    sourceStageRevisions: sources, selectedSources, canConfirm, confirm };
  // Changing this key really unmounts the child, as Chat's loading Inspector
  // becoming the resolved Shell does; the project-owned hook stays mounted.
  return <div key={host} data-testid={`host-${host}`}><AidtReportPreview reviewView={view} drafts={emptyAidtUiDrafts()}
    text={markdown} sourceRevision={1} revision={1} onChange={vi.fn()} regenerate={vi.fn()} readOnly={false} shared={shared} /></div>;
}
function review() {
  fireEvent.click(screen.getByRole("button", { name: "阅读预览" }));
  fireEvent.click(screen.getByRole("button", { name: "确认审阅此版本" }));
  return screen.getByRole("button", { name: "确认小组报告" });
}

describe("project-owned AIDT report review lifecycle", () => {
  it.each(["ready", "failed"])("retains reading and explicit review across a delayed Chat host remount (%s), then confirms once", host => {
    const confirm = vi.fn().mockResolvedValue(undefined); let latest: AidtReportReviewView;
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const props = { confirm, expose: (view: AidtReportReviewView) => { latest = view; } };
    const page = render(<Owner {...props} />);
    const before = review();
    expect(confirm).not.toHaveBeenCalled();
    page.rerender(<Owner {...props} host={host} />);
    const after = screen.getByRole("button", { name: "确认小组报告" });
    expect(after).not.toBe(before);
    expect(screen.getByRole("article", { name: "小组报告阅读预览" })).toHaveTextContent(manuscript.slice(7));
    fireEvent.click(after);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "确认小组报告" })).toBeNull();
    expect(latest!.takeReview()).toBe(false);
    expect(storage).not.toHaveBeenCalled(); storage.mockRestore();
  });

  it.each([
    { revision: 2 }, { markdown: "# 修改过的正文，必须重新审阅" },
    { sources: [{ stageId: 1, revision: 2 }] }, { selectedSources: [{ stageId: 2, revision: 1 }] }, { canConfirm: false },
  ])("invalidates a prior review when the actual report proof changes: %j", patch => {
    const confirm = vi.fn().mockResolvedValue(undefined); let latest: AidtReportReviewView;
    const props = { confirm, expose: (view: AidtReportReviewView) => { latest = view; } };
    const page = render(<Owner {...props} />); review(); const stale = latest!;
    page.rerender(<Owner {...props} {...patch} />);
    expect(screen.getByRole("article", { name: "小组报告阅读预览" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "确认小组报告" })).toBeNull();
    expect(stale.takeReview()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(["org-b/user-a/session-a/project-a/report-a", "org-a/user-b/session-a/project-a/report-a", "org-a/user-a/session-b/project-a/report-a",
    "org-a/user-a/session-a/project-b/report-a", "org-a/user-a/session-a/project-a/report-b"])("does not carry a review across identity or report scope changes, including A→B→A: %s", scope => {
    const confirm = vi.fn().mockResolvedValue(undefined); let latest: AidtReportReviewView;
    const props = { confirm, expose: (view: AidtReportReviewView) => { latest = view; } };
    const page = render(<Owner {...props} />); review(); const stale = latest!;
    page.rerender(<Owner {...props} scope={scope} />);
    expect(screen.getByRole("textbox", { name: "小组报告草稿" })).toBeVisible();
    page.rerender(<Owner {...props} />);
    expect(screen.queryByRole("button", { name: "确认小组报告" })).toBeNull();
    expect(stale.takeReview()).toBe(false);
    expect(stale.review()).toBeUndefined();
    expect(latest!.reviewRevision).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps the current review usable through React StrictMode effect replay", () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    render(<React.StrictMode><Owner confirm={confirm} /></React.StrictMode>);
    fireEvent.click(review());
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "确认小组报告" })).toBeNull();
  });

  it("unmounting the project owner invalidates every captured review callback", () => {
    const confirm = vi.fn().mockResolvedValue(undefined); let latest: AidtReportReviewView;
    const page = render(<Owner confirm={confirm} expose={view => { latest = view; }} />);
    review(); const stale = latest!;
    page.unmount();
    expect(stale.takeReview()).toBe(false);
    stale.review(); stale.setPreview(true); stale.clearReview();
    expect(stale.takeReview()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("returning to edit invalidates old reading handlers, even after entering reading again", () => {
    const confirm = vi.fn().mockResolvedValue(undefined); let latest: AidtReportReviewView;
    render(<Owner confirm={confirm} expose={view => { latest = view; }} />);
    review(); const oldReading = latest!;
    fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
    oldReading.review(); oldReading.setPreview(true);
    expect(oldReading.takeReview()).toBe(false);
    expect(screen.getByRole("textbox", { name: "小组报告草稿" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "阅读预览" }));
    oldReading.review();
    expect(oldReading.takeReview()).toBe(false);
    expect(screen.queryByRole("button", { name: "确认小组报告" })).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认审阅此版本" }));
    fireEvent.click(screen.getByRole("button", { name: "确认小组报告" }));
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("a changed manuscript returning to the same bytes never resurrects its earlier review or stale callbacks", () => {
    const confirm = vi.fn().mockResolvedValue(undefined); let latest: AidtReportReviewView;
    const props = { confirm, expose: (view: AidtReportReviewView) => { latest = view; } };
    const page = render(<Owner {...props} />); review(); const stale = latest!;
    page.rerender(<Owner {...props} markdown="临时修改稿" />);
    page.rerender(<Owner {...props} />);
    expect(screen.queryByRole("button", { name: "确认小组报告" })).toBeNull();
    expect(stale.takeReview()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "确认审阅此版本" }));
    expect(stale.takeReview()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "确认小组报告" }));
    expect(confirm).toHaveBeenCalledOnce();
  });
});
