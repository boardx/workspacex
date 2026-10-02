import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { ResearchTopicInformation } from "@/components/research-studio/research-topic-information";
import { runtimeFixture } from "../guided-runtime-fixture";

afterEach(() => vi.useRealTimers());
describe("topic autosave", () => {
  it("serializes edits typed while a previous save is pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let finish!: (saved: boolean) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; })).mockResolvedValue(true);
    render(<ResearchTopicInformation brief={runtimeFixture().brief} disabled={false} onSave={save} />);
    fireEvent.change(screen.getByRole("textbox", { name: "研究主题" }), { target: { value: "第一版" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    fireEvent.change(screen.getByRole("textbox", { name: "研究主题" }), { target: { value: "第二版" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ topic: "第二版" }));
    expect(screen.getByRole("textbox", { name: "研究主题" })).toHaveValue("第二版");
    expect(screen.getByRole("status")).toHaveTextContent("已保存");
  });
  it("saves a valid edit after typing stops without a confirmation dialog", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn().mockResolvedValue(true);
    render(<ResearchTopicInformation brief={runtimeFixture().brief} disabled={false} onSave={save} />);
    fireEvent.change(screen.getByRole("textbox", { name: "研究主题" }), { target: { value: "更新研究" } });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ topic: "更新研究" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已保存");
  });
  it("retains an edit and exposes retry when saving fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<ResearchTopicInformation brief={runtimeFixture().brief} disabled={false} onSave={save} />);
    fireEvent.change(screen.getByRole("textbox", { name: "研究主题" }), { target: { value: "保留输入" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("textbox", { name: "研究主题" })).toHaveValue("保留输入");
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存"));
  });
});
