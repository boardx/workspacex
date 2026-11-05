import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
function LocaleControl() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
const props: ChatTaskInspectorProps = { hasSelection: true, threadId: "raw-thread", artifacts: null, materials: { items: [] }, loading: false, artifactsError: null, materialsError: null, onRetry: vi.fn(), pendingMaterialsCount: 0, planTodos: null, isRunning: false, runPhaseLabel: null, runStartedAt: null };
afterEach(cleanup);
it("stores the non-file drop outcome semantically without uploading or clearing it on locale", () => {
  const pickFiles = vi.fn();
  render(<I18nProvider initialLocale="en"><LocaleControl /><ChatTaskInspector {...props} attachUploadPort={{ pickFiles, banner: null }} /></I18nProvider>);
  const surface = screen.getByTestId("chat-task-workbench-inspector");
  fireEvent.drop(surface, { dataTransfer: { files: [], types: ["text/plain"] } });
  const notice = screen.getByTestId("chat-materials-upload-notice");
  expect(notice.textContent).toBe("Only files can be dropped here. Text, links and folders were not uploaded.");
  expect(surface).toHaveAttribute("data-active-tab", "materials"); expect(pickFiles).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-materials-upload-notice")).toBe(notice);
  expect(notice.textContent).toBe("只支持拖入文件。拖进来的是文字、链接或文件夹（浏览器不把文件夹当文件交给网页），没有上传任何东西。");
  expect(pickFiles).not.toHaveBeenCalled();
});
it("preserves caller-owned read-only reasons and blocks the original upload port", () => {
  const pickFiles = vi.fn(); const reason = "管理员原文 {reason}";
  render(<I18nProvider initialLocale="en"><LocaleControl /><ChatTaskInspector {...props} uploadDisabledReason={reason} attachUploadPort={{ pickFiles, banner: null }} /></I18nProvider>);
  fireEvent.drop(screen.getByTestId("chat-task-workbench-inspector"), { dataTransfer: { files: [new File(["raw"], "用户文件.md")], types: ["Files"] } });
  const notice = screen.getByTestId("chat-materials-upload-notice"); expect(notice.textContent).toBe(reason);
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(notice.textContent).toBe(reason);
  expect(pickFiles).not.toHaveBeenCalled();
});
