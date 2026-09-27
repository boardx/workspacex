import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createWhiteboardDocument, executeCommands, readObjects } from "@repo/whiteboard-core";
import { CollaborativeEditor } from "@/components/whiteboard/collaborative-editor";
import type { BoardFabricObject } from "@/components/whiteboard/fabric/board-fabric-object";

vi.mock("@/components/whiteboard/fabric/board-fabric-surface", () => ({
  BoardFabricSurface: ({ objects }: { objects: readonly BoardFabricObject[] }) => (
    <div data-testid="board-fabric-surface">
      {objects.map((object) => <span key={object.id} data-projected-id={object.id} />)}
    </div>
  ),
}));

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
afterEach(cleanup);

it("projects user and agent presence around Fabric objects without persisting ephemeral state", () => {
  const doc = createWhiteboardDocument();
  executeCommands(doc, [{
    type: "create",
    object: {
      id: "presence-note",
      schemaVersion: 1,
      kind: "sticky",
      geometry: { x: 40, y: 60, width: 180, height: 140, rotation: 0 },
      text: "协作中的便签",
      style: {},
      parentId: null,
      orderKey: "a",
    },
  }], "fixture");
  const before = readObjects(doc);
  const view = render(
    <CollaborativeEditor
      boardId="board-presence"
      clientId="client-local"
      currentUserId="local-user"
      doc={doc}
      readOnly={false}
      title="协作板"
      status="已同步"
      peers={[
        {
          actorId: "remote-user",
          displayName: "Grace",
          principalKind: "user",
          avatarUrl: null,
          contributorColor: "#2563EB",
          cursor: { x: 90, y: 80 },
          selected: ["presence-note"],
          editingObjectId: "presence-note",
          viewport: { centerX: 30, centerY: 40, zoom: 1, revision: 1 },
          presenting: true,
          followingActorId: null,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        {
          actorId: "agent-1",
          displayName: "Research Agent",
          principalKind: "agent",
          avatarUrl: null,
          contributorColor: "#7C3AED",
          cursor: { x: 180, y: 120 },
          selected: [],
          editingObjectId: null,
          viewport: null,
          presenting: false,
          followingActorId: null,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ]}
    />,
  );

  expect(screen.getByLabelText("Grace的光标")).toBeVisible();
  expect(screen.getByLabelText("Grace正在编辑协作中的便签")).toHaveStyle({ borderColor: "#2563EB" });
  expect(screen.getByRole("button", { name: /跟随Grace/ })).toBeVisible();
  expect(screen.getByLabelText("Research Agent的光标")).toBeVisible();
  expect(readObjects(doc)).toEqual(before);

  view.unmount();
  doc.destroy();
});
