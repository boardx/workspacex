import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DigitalInterviewCreateModal } from "@/components/itv/digital-interview-create-modal";
const mocks = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/interview-api", () => ({ createDigitalInterviewDraft: mocks.create }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("announces and focuses a failed create without losing the name or retry identity", async () => {
  mocks.create.mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce({ interviewId: "retry-one" });
  render(<DigitalInterviewCreateModal open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("访谈名称"), { target: { value: "夜班访谈" } });
  fireEvent.click(screen.getByRole("button", { name: "开始访谈" }));
  const error = await screen.findByRole("alert");
  await waitFor(() => expect(error).toHaveFocus());
  expect(screen.getByLabelText("访谈名称")).toHaveValue("夜班访谈");
  fireEvent.click(screen.getByRole("button", { name: "开始访谈" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/itv/retry-one/intake"));
  expect(mocks.create.mock.calls[1]![0].requestId).toBe(mocks.create.mock.calls[0]![0].requestId);
});
it("explains why an empty name cannot be submitted", () => {
  render(<DigitalInterviewCreateModal open onOpenChange={vi.fn()} />);
  const input = screen.getByLabelText("访谈名称");
  fireEvent.change(input, { target: { value: "   " } });
  expect(screen.getByRole("button", { name: "开始访谈" })).toBeDisabled();
  expect(input).toHaveAccessibleDescription("请输入访谈名称后继续。");
  expect(mocks.create).not.toHaveBeenCalled();
});
