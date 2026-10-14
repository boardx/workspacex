import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardDownloadControls } from "../../components/whiteboard/board-download-controls";
const renderImage = vi.hoisted(() => vi.fn());
vi.mock("../../components/whiteboard/board-canonical-image", () => ({ renderCanonicalBoardImage: renderImage }));
vi.mock("@/lib/canvas/export-image", () => ({ buildPdfFromPng: vi.fn(async () => ({ output: () => new Blob(["pdf"], { type: "application/pdf" }) })) }));
beforeEach(() => { vi.clearAllMocks(); URL.createObjectURL = vi.fn(() => "blob:board-export"); URL.revokeObjectURL = vi.fn(); vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); });
describe("Board download controls", () => {
  it("exports full canonical content without requiring a selection", async () => {
    renderImage.mockResolvedValue({ blob: new Blob(["png"], { type: "image/png" }), width: 500, height: 300 });
    const objects: never[] = [];
    render(<BoardDownloadControls boardId="board" title="Board" objects={objects}/>);
    fireEvent.click(screen.getByTestId("board-download-png"));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce());
    expect(renderImage).toHaveBeenCalledWith(expect.objectContaining({ boardId: "board", objects }));
    expect(screen.queryByText("演示视图")).toBeNull();
  });
  it("keeps both download buttons disabled during rendering and reports asset errors without downloading placeholders", async () => {
    let reject!: (reason: Error) => void;
    renderImage.mockReturnValue(new Promise((_, failure) => { reject = failure; }));
    render(<BoardDownloadControls boardId="board" title="Board" objects={[]}/>);
    fireEvent.click(screen.getByTestId("board-download-png"));
    expect(screen.getByTestId("board-download-pdf").hasAttribute("disabled")).toBe(true);
    reject(new Error("IMAGE_ACCESS_DENIED"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("下载失败"));
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
});
