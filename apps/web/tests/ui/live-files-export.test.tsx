import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LiveFilesBrowser } from "@/components/files/live-files-browser";
const calls = vi.hoisted(() => ({ save: vi.fn(async () => {}),
  get: vi.fn(async () => ({ jobId: "job", status: "done", downloadUrl: "/export-jobs/job/content", failureReason: null as string | null })) }));
vi.mock("@/lib/live-files", () => ({ listProjectArtifacts: async () => ({ nodes: [] }), getArtifactTree: async () => ({ tree: [] }),
  createExportJob: async () => ({ jobId: "job", status: "done" }), getExportJob: calls.get,
  saveExportArchive: calls.save, renameArtifact: vi.fn() }));
beforeEach(() => { calls.save.mockClear(); calls.get.mockClear(); });
it("downloads an immediately completed export from the real browser button", async () => {
  const toast = vi.fn(); render(<LiveFilesBrowser projectId="project" onToast={toast} />);
  await screen.findByTestId("live-files-tree-empty");
  fireEvent.click(screen.getByTestId("live-files-export"));
  await waitFor(() => expect(calls.save).toHaveBeenCalledWith("job"));
  expect(toast).toHaveBeenCalledWith("导出完成，已开始下载 ZIP 文件");
});
it("does not announce success if the authenticated byte download fails", async () => {
  calls.save.mockRejectedValueOnce(new Error("HTTP 403"));
  const toast = vi.fn(); render(<LiveFilesBrowser projectId="project" onToast={toast} />);
  await screen.findByTestId("live-files-tree-empty"); fireEvent.click(screen.getByTestId("live-files-export"));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("导出请求失败：HTTP 403"));
  expect(toast).not.toHaveBeenCalledWith("导出完成，已开始下载 ZIP 文件");
});
