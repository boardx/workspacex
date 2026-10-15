import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { StudioHistoryHeader } from "@/components/studio/studio-history";
import { CreateTranscriptionDialog } from "@/components/rec/create-transcription-dialog";

function Harness({ onCreate = async () => undefined }: { onCreate?: () => Promise<void> }) {
  const [open, setOpen] = React.useState(false);
  return <><StudioHistoryHeader business="转录" description="" createTestId="create" onCreate={() => setOpen(true)} /><CreateTranscriptionDialog open={open} onOpenChange={setOpen} onCreate={onCreate} /></>;
}
async function openDialog() {
  const trigger = screen.getByTestId("create");
  trigger.focus(); fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByLabelText("转录名称")).toHaveFocus());
  return trigger;
}
for (const action of ["cancel", "escape"] as const) it(`restores the history trigger after ${action}`, async () => {
  render(<Harness />);
  const trigger = await openDialog();
  expect(screen.getByRole("textbox", { name: "添加标签" })).toBeInTheDocument();
  if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "取消" }));
  else fireEvent.keyDown(screen.getByLabelText("转录名称"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});
it("does not reclaim trigger focus after successful creation", async () => {
  const onCreate = vi.fn(async () => undefined);
  render(<Harness onCreate={onCreate} />);
  const trigger = await openDialog();
  fireEvent.click(screen.getByRole("button", { name: "创建并进入" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(trigger).not.toHaveFocus();
});
