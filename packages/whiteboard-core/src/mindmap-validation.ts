import { WhiteboardMindmapMetadata, type WhiteboardObject, type WhiteboardCommand } from '@repo/contracts/whiteboard-document';

/** Used by candidate commands, persisted snapshots and server replay, not just UI planning. */
export function validateMindmapTrees(objects: readonly WhiteboardObject[]): void {
  const nodes = new Map<string, { object: WhiteboardObject; treeId: string }>();
  const edges: { object: WhiteboardObject; treeId: string }[] = [];
  for (const object of objects) {
    const raw = object.extensionData?.mindmap;
    if (raw === undefined) continue;
    const metadata = WhiteboardMindmapMetadata.parse(raw);
    if (metadata.role === 'node') {
      if (object.kind !== 'sticky') throw new Error('MINDMAP_INVALID_NODE');
      nodes.set(object.id, { object, treeId: metadata.treeId });
    } else {
      if (object.kind !== 'connector') throw new Error('MINDMAP_INVALID_EDGE');
      edges.push({ object, treeId: metadata.treeId });
    }
  }
  const incoming = new Map<string, string>();
  for (const { object, treeId } of edges) {
    const connector = object.connector!;
    const from = connector.from && nodes.get(connector.from);
    const to = connector.to && nodes.get(connector.to);
    if (!from || !to || from.treeId !== treeId || to.treeId !== treeId || connector.fromPoint || connector.toPoint) throw new Error('MINDMAP_INVALID_ENDPOINT');
    if (connector.to === treeId || incoming.has(connector.to!)) throw new Error('MINDMAP_MULTIPLE_PARENTS');
    incoming.set(connector.to!, connector.from!);
  }
  for (const [id, node] of nodes) {
    const root = nodes.get(node.treeId);
    if (!root || root.treeId !== node.treeId) throw new Error('MINDMAP_ROOT_NOT_FOUND');
    const visited = new Set<string>();
    let current = id;
    while (current !== node.treeId) {
      if (visited.has(current)) throw new Error('MINDMAP_CYCLE');
      visited.add(current);
      const parent = incoming.get(current);
      if (!parent) throw new Error('MINDMAP_DISCONNECTED_NODE');
      current = parent;
    }
  }
}

/** Structural changes must use an operation with a locked head/version check. */
export function mindmapStructureDigest(objects: readonly WhiteboardObject[]): string {
  return JSON.stringify(objects.filter(object => object.extensionData?.mindmap !== undefined)
    .map(object => ({id:object.id,metadata:object.extensionData!.mindmap,
      ...(object.kind === 'connector' ? {from:object.connector!.from,to:object.connector!.to} : {})}))
    .sort((a,b)=>a.id.localeCompare(b.id)));
}

export function commandsChangeMindmapStructure(objects: readonly WhiteboardObject[], commands: readonly WhiteboardCommand[]): boolean {
  const byId = new Map(objects.map(object => [object.id, object]));
  return commands.some(command => {
    if (command.type === 'create') return command.object.extensionData?.mindmap !== undefined;
    const object = byId.get(command.id);
    if (command.type === 'extension') return command.key === 'mindmap' || command.extensionData?.mindmap !== undefined || object?.extensionData?.mindmap !== undefined;
    return ['connector', 'delete', 'restore'].includes(command.type) && object?.extensionData?.mindmap !== undefined;
  });
}
