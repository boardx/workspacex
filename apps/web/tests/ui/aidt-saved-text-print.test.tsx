import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AidtSavedTextPrint } from "@/features/aidt/components/aidt-saved-text-print";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
const mocks = vi.hoisted(() => ({ read: vi.fn(), preview: vi.fn(), user: "student-a" }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { sessionToken: "qa-session", userId: mocks.user, currentOrgId: "qa-org" } }) }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.read }));
vi.mock("@/features/aidt/lib/aidt-print-preview", () => ({ previewAidtText: mocks.preview }));
const draft: AidtUiStageDraft = { fields: { text: "学生确认的意外发现，来源受访者U01", confirmed: "true" }, ideas: [], selectedIdeaId: "" };
const select = (value: AidtUiStageDraft) => value.fields.confirmed === "true" ? value.fields.text || null : null;
const renderButton = (value = draft) => render(<AidtSavedTextPrint projectId="qa" stageId={3} label="打印意外发现" draft={value} selectText={select} />);
beforeEach(() => { vi.clearAllMocks(); mocks.user = "student-a"; mocks.read.mockResolvedValue({ stage: { revision: 4, content: { draft } } }); mocks.preview.mockResolvedValue("cancelled"); });
afterEach(cleanup);
it("reads the formal saved revision before preview and never writes on cancel", async () => {
  renderButton(); fireEvent.click(screen.getByRole("button", { name: "打印意外发现" }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  expect(mocks.read).toHaveBeenCalledWith("qa", 3, "qa-session");
  expect(mocks.preview).toHaveBeenCalledWith(draft.fields.text, "打印意外发现 · 第3步 V4", expect.objectContaining({ defaultPaper: "A4", isCurrent: expect.any(Function) }));
  expect(draft.fields.confirmed).toBe("true");
});
it("rejects a local text which differs from the saved formal artifact", async () => {
  mocks.read.mockResolvedValue({ stage: { revision: 4, content: { draft: { ...draft, fields: { ...draft.fields, text: "另一个保存版本" } } } } });
  renderButton(); fireEvent.click(screen.getByRole("button", { name: "打印意外发现" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("请先保存并确认"); expect(mocks.preview).not.toHaveBeenCalled();
});
it("does not offer a misleading print button for an unconfirmed or empty artifact", () => {
  renderButton({ ...draft, fields: { ...draft.fields, confirmed: "" } }); expect(screen.queryByRole("button")).toBeNull(); expect(mocks.read).not.toHaveBeenCalled();
});
it("rejects a late saved read after actor switch and invalidates an already-open preview", async () => {
  let finish!: (value: unknown) => void; mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = renderButton(); fireEvent.click(screen.getByRole("button", { name: "打印意外发现" }));
  mocks.user = "student-b"; view.rerender(<AidtSavedTextPrint projectId="qa" stageId={3} label="打印意外发现" draft={draft} selectText={select} />);
  await act(async () => { finish({ stage: { revision: 4, content: { draft } } }); }); expect(mocks.preview).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "打印意外发现" })); await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
  const isCurrent = mocks.preview.mock.calls[0]![2].isCurrent; expect(isCurrent()).toBe(true); view.unmount(); expect(isCurrent()).toBe(false);
});
