import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudioMetadataDialog, StudioDeleteDialog } from "@/components/studio/studio-history-management";

function edit(onSave: (draft: { name: string; tags: readonly string[] }) => Promise<void>) {
  const onOpenChange = vi.fn();
  render(<StudioMetadataDialog business="访谈" prefix="test" open initialName="原名称" initialTags={["旧标签"]} onSave={onSave} onOpenChange={onOpenChange} />);
  return onOpenChange;
}

describe("Studio history management", () => {
  it("saves a pending tag without Enter, trims the name, and blocks duplicate form submissions", async () => {
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const closed = edit(save);
    fireEvent.change(screen.getByTestId("test-edit-name"), { target: { value: "  新名称  " } });
    fireEvent.change(screen.getByTestId("test-edit-tags"), { target: { value: " 新标签 " } });
    const form = screen.getByTestId("test-edit-submit").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ name: "新名称", tags: ["旧标签", "新标签"] });
    expect(screen.getByTestId("test-edit-submit")).toBeDisabled();
    expect(closed).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(closed).toHaveBeenCalledWith(false);
  });

  it("keeps failed edits open with their input and permits retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const closed = edit(save);
    fireEvent.change(screen.getByTestId("test-edit-name"), { target: { value: "保留名称" } });
    fireEvent.change(screen.getByTestId("test-edit-tags"), { target: { value: "保留标签" } });
    fireEvent.click(screen.getByTestId("test-edit-submit"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(closed).not.toHaveBeenCalled();
    expect(screen.getByTestId("test-edit-name")).toHaveValue("保留名称");
    expect(screen.getByTestId("test-edit-tags")).toHaveValue("保留标签");
    fireEvent.click(screen.getByTestId("test-edit-submit"));
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  });

  it("removing a tag never submits the edit form", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    edit(save);
    fireEvent.click(screen.getByRole("button", { name: "移除标签 旧标签" }));
    expect(screen.queryByRole("button", { name: "移除标签 旧标签" })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("canceling deletion never invokes the API callback", () => {
    const remove = vi.fn();
    const closed = vi.fn();
    render(<StudioDeleteDialog business="研究" prefix="test" name="研究名称" description="将被删除" open onOpenChange={closed} onConfirm={remove} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(closed).toHaveBeenCalledWith(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("blocks concurrent deletion and retries after rejection", async () => {
    let reject!: (error: Error) => void;
    const remove = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValueOnce(undefined);
    const closed = vi.fn();
    render(<StudioDeleteDialog business="研究" prefix="test" name="研究名称" description="将被删除" open onOpenChange={closed} onConfirm={remove} />);
    fireEvent.click(screen.getByTestId("test-delete-confirm"));
    fireEvent.click(screen.getByTestId("test-delete-confirm"));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    await act(async () => reject(new Error("offline")));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(closed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("test-delete-confirm"));
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
