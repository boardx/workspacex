import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { BoardTransferControls } from "@/components/whiteboard/board-transfer-controls";
import * as api from "@/lib/live-whiteboard";
import { whiteboardTransfer as T } from "@repo/contracts";
vi.mock("@/lib/live-whiteboard", () => ({
  disconnectMural: vi.fn(),
  exportBoardPackage: vi.fn(),
  getMuralConnection: vi.fn(),
  importBoardPackage: vi.fn(),
  listMuralWorkspaces: vi.fn(),
  listWorkspaceMurals: vi.fn(),
  previewBoardImport: vi.fn(),
  previewMural: vi.fn(),
  startMuralOAuth: vi.fn(),
}));
const bundle = T.createPortableBoardPackage({
    format: "workspacex.board",
    schemaVersion: 1,
    source: {
      application: "WorkspaceX",
      boardId: randomUUID(),
      name: "Imported Mural",
    },
    objects: [],
  }),
  quality = T.completeImportQuality([]),
  preview = {
    sourceName: "Imported Mural",
    destinationName: "Imported Mural（导入）",
    objectCount: 0,
    frameCount: 0,
    groupCount: 0,
    connectorCount: 0,
    identitiesRemapped: 0,
    contentLosses: [],
    quality,
  };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => randomUUID() });
  vi.mocked(api.getMuralConnection).mockResolvedValue({
    connected: true,
    scopes: ["workspaces:read", "murals:read"],
    connectedAt: "2026-09-24T00:00:00.000Z",
  });
  vi.mocked(api.listMuralWorkspaces).mockResolvedValue({
    items: [{ id: "w", name: "Design" }],
    next: "workspace-next",
  });
  vi.mocked(api.listWorkspaceMurals).mockResolvedValue({
    items: [{ id: "m", name: "Workshop", modifiedAt: null }],
    next: "mural-next",
  });
  vi.mocked(api.previewMural).mockResolvedValue({
    input: { requestId: randomUUID(), package: bundle },
    preview,
    external: {
      provider: "mural",
      sourceBoardId: "m",
      sourceName: "Workshop",
      importedObjectCount: 0,
      skippedObjectCount: 0,
      losses: [
        {
          code: "DRAWINGS_NOT_INCLUDED",
          message:
            "Mural Public API 不提供 drawings，因此无法统计或导入绘图内容。",
        },
      ],
      quality,
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Mural direct import picker", () => {
  it("walks workspace to active mural, preserves opaque next tokens, and shows the drawing limitation before confirmation", async () => {
    vi.mocked(api.listMuralWorkspaces)
      .mockResolvedValueOnce({
        items: [{ id: "w", name: "Design" }],
        next: "workspace-next",
      })
      .mockResolvedValueOnce({
        items: [{ id: "w2", name: "Research" }],
        next: null,
      });
    vi.mocked(api.listWorkspaceMurals)
      .mockResolvedValueOnce({
        items: [{ id: "m", name: "Workshop", modifiedAt: null }],
        next: "mural-next",
      })
      .mockResolvedValueOnce({
        items: [{ id: "m2", name: "Retro", modifiedAt: null }],
        next: null,
      });
    render(
      <BoardTransferControls boardId={randomUUID()} onImported={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("board-import-mural"));
    expect(await screen.findByTestId("mural-workspace-w")).toBeTruthy();
    fireEvent.click(screen.getByText("加载更多 Workspace"));
    await waitFor(() =>
      expect(api.listMuralWorkspaces).toHaveBeenCalledWith({
        next: "workspace-next",
        limit: 50,
      }),
    );
    fireEvent.click(screen.getByTestId("mural-workspace-w"));
    expect(await screen.findByTestId("mural-board-m")).toBeTruthy();
    fireEvent.click(screen.getByText("加载更多 Mural"));
    await waitFor(() =>
      expect(api.listWorkspaceMurals).toHaveBeenCalledWith({
        workspaceId: "w",
        next: "mural-next",
        limit: 50,
      }),
    );
    fireEvent.click(screen.getByTestId("mural-board-m"));
    const losses = await screen.findByTestId("vendor-import-losses");
    expect(losses.textContent).toContain("Mural Public API");
    expect(losses.textContent).toContain("无法统计或导入");
    expect(api.previewMural).toHaveBeenCalledWith(
      expect.objectContaining({ muralId: "m" }),
    );
  });
  it("disconnects the local connection and returns to the connect state", async () => {
    vi.mocked(api.disconnectMural).mockResolvedValue({ disconnected: true });
    render(
      <BoardTransferControls boardId={randomUUID()} onImported={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("board-import-mural"));
    await screen.findByTestId("mural-disconnect");
    fireEvent.click(screen.getByTestId("mural-disconnect"));
    expect(await screen.findByTestId("mural-connect")).toBeTruthy();
    expect(api.disconnectMural).toHaveBeenCalledTimes(1);
  });
});
