import { WhiteboardMindmapMetadata, type WhiteboardObject } from '@repo/contracts/whiteboard-document';

export function readMindmapMetadata(object: WhiteboardObject) {
  const parsed = WhiteboardMindmapMetadata.safeParse(object.extensionData?.mindmap);
  return parsed.success ? parsed.data : null;
}
export interface MindmapTree {
  root: WhiteboardObject;
  nodes: Map<string, WhiteboardObject>;
  edges: Map<string, WhiteboardObject>;
  children: Map<string, string[]>;
  incoming: Map<string, WhiteboardObject>;
}
/** Relations are read only from tagged canonical connector endpoints. */
export function readMindmapTree(objects: readonly WhiteboardObject[], treeId: string): MindmapTree {
  const nodes = new Map<string, WhiteboardObject>();
  const edges = new Map<string, WhiteboardObject>();
  const incoming = new Map<string, WhiteboardObject>();
  const children = new Map<string, string[]>();
  for (const object of objects) {
    const metadata = readMindmapMetadata(object);
    if (metadata?.treeId !== treeId) continue;
    if (metadata.role === 'node') {
      if (object.kind !== 'sticky') throw new Error('MINDMAP_NODE_KIND');
      nodes.set(object.id, object);
    } else edges.set(object.id, object);
  }
  if (nodes.size > 500) throw new Error('MINDMAP_WORK_LIMIT');
  const root = nodes.get(treeId);
  if (!root) throw new Error('MINDMAP_ROOT_MISSING');
  for (const edge of edges.values()) {
    const from = edge.connector?.from, to = edge.connector?.to;
    if (edge.kind !== 'connector' || !from || !to || !nodes.has(from) || !nodes.has(to) || from === to) throw new Error('MINDMAP_ENDPOINT_INVALID');
    if (incoming.has(to)) throw new Error('MINDMAP_MULTIPLE_PARENTS');
    incoming.set(to, edge);
    children.set(from, [...(children.get(from) ?? []), to]);
  }
  if (incoming.has(treeId)) throw new Error('MINDMAP_ROOT_PARENT');
  for (const [parent, kids] of children) children.set(parent, kids.sort((a, b) => {
    const aEdge = incoming.get(a)!, bEdge = incoming.get(b)!;
    const aKey = readMindmapMetadata(aEdge)!, bKey = readMindmapMetadata(bEdge)!;
    const left = aKey.role === 'edge' ? aKey.siblingOrder : '', right = bKey.role === 'edge' ? bKey.siblingOrder : '';
    return left < right ? -1 : left > right ? 1 : aEdge.id < bEdge.id ? -1 : aEdge.id > bEdge.id ? 1 : 0;
  }));
  const seen = new Set<string>();
  const visit = (id: string) => { if (seen.has(id)) throw new Error('MINDMAP_CYCLE'); seen.add(id); for (const child of children.get(id) ?? []) visit(child); };
  visit(treeId);
  if (seen.size !== nodes.size) throw new Error('MINDMAP_DISCONNECTED');
  return { root, nodes, edges, children, incoming };
}
/** Deterministic variable-size LR subtree layout, retaining the root position. */
export function computeMindmapLayout(objects: readonly WhiteboardObject[], treeId: string): Map<string, WhiteboardObject['geometry']> {
  const tree = readMindmapTree(objects, treeId);
  const heights = new Map<string, number>();
  const gapX = 80, gapY = 32;
  const shownChildren = (id: string) => { const metadata=readMindmapMetadata(tree.nodes.get(id)!); return metadata?.role==='node' && metadata.collapsed ? [] : tree.children.get(id) ?? []; };
  const measure = (id: string): number => {
    const kids = shownChildren(id), own = tree.nodes.get(id)!.geometry.height;
    const childrenHeight = kids.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, kids.length - 1) * gapY;
    const height = Math.max(own, childrenHeight); heights.set(id, height); return height;
  };
  measure(treeId);
  const geometries = new Map<string, WhiteboardObject['geometry']>();
  const place = (id: string, x: number, centerY: number) => {
    const object = tree.nodes.get(id)!, kids = shownChildren(id);
    geometries.set(id, { ...object.geometry, x, y: centerY - object.geometry.height / 2 });
    const total = kids.reduce((sum, child) => sum + heights.get(child)!, 0) + Math.max(0, kids.length - 1) * gapY;
    let cursor = centerY - total / 2;
    for (const child of kids) { const height = heights.get(child)!; place(child, x + object.geometry.width + gapX, cursor + height / 2); cursor += height + gapY; }
  };
  place(treeId, tree.root.geometry.x, tree.root.geometry.y + tree.root.geometry.height / 2);
  return geometries;
}
/** Visibility is a projection: do not mutate canonical hidden or delete nodes. */
export function mindmapHiddenIds(objects: readonly WhiteboardObject[]): Set<string> {
  const hidden = new Set<string>();
  const roots = objects.filter(object => { const meta = readMindmapMetadata(object); return meta?.role === 'node' && meta.treeId === object.id; });
  for (const root of roots) {
    const tree = readMindmapTree(objects, root.id);
    const visit = (id: string, ancestorCollapsed: boolean) => {
      if (ancestorCollapsed) { hidden.add(id); const incoming = tree.incoming.get(id); if (incoming) hidden.add(incoming.id); }
      const meta = readMindmapMetadata(tree.nodes.get(id)!);
      const collapsed = ancestorCollapsed || (meta?.role === 'node' && meta.collapsed);
      for (const child of tree.children.get(id) ?? []) visit(child, collapsed);
    };
    visit(root.id, false);
  }
  for (const object of objects) if (object.connector && (hidden.has(object.connector.from ?? '') || hidden.has(object.connector.to ?? ''))) hidden.add(object.id);
  return hidden;
}
