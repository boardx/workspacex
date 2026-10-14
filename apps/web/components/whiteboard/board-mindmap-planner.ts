import { createStickyBatchEnvelope, type WhiteboardCommand, type WhiteboardObject } from '@repo/whiteboard-core';
import { computeMindmapLayout, readMindmapMetadata, readMindmapTree } from '@repo/whiteboard-core';
import type { DiagramModel } from '@repo/fabric-markdown/model';

export type MindmapAction =
  | { action: 'create-root'; id: string; text: string; position: { x: number; y: number } }
  | { action: 'add-child' | 'add-sibling'; nodeId: string; id: string; edgeId: string; text: string }
  | { action: 'reparent'; nodeId: string; newParentId: string }
  | { action: 'set-collapsed'; nodeId: string; collapsed: boolean }
  | { action: 'layout'; treeId: string }
  | { action: 'delete-subtree'; nodeId: string }
  | { action: 'import-mermaid'; model: DiagramModel; ids: Record<string, string>; edgeIds: Record<string, string>; position: { x: number; y: number } };
export interface MindmapPlan { action: MindmapAction['action']; treeId: string; commands: WhiteboardCommand[]; selectedId: string | null }
const metadata = (treeId: string, collapsed = false) => ({ version: 1 as const, role: 'node' as const, treeId, collapsed });
function sticky(id: string, treeId: string, text: string, position: { x: number; y: number }, inherited?: WhiteboardObject): WhiteboardObject {
  const envelope = createStickyBatchEnvelope({ boardId: 'mindmap-planner', clientId: 'mindmap-planner', gestureId: 'mindmap-planner', sizing: 'fixed', color: { custom: inherited?.style.fill ?? '#FFE99A' }, items: [{ id, text, geometry: { x: position.x, y: position.y, width: inherited?.geometry.width ?? 180, height: inherited?.geometry.height ?? 180, rotation: 0 }, extensionData: { mindmap: metadata(treeId) } }] });
  const command = envelope.commands[0]!;
  if (command.type !== 'create') throw new Error('MINDMAP_CREATE_INVALID');
  return command.object;
}
function edge(id: string, treeId: string, from: string, to: string, siblingOrder: string): WhiteboardObject {
  return { id, schemaVersion: 1, kind: 'connector', text: '', parentId: null, orderKey: '', geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, style: {}, connector: { from, to, fromAnchor: 'right', toAnchor: 'left', type: 'curve', startStyle: 'none', endStyle: 'none', lineStyle: 'solid' }, extensionData: { mindmap: { version: 1, role: 'edge', treeId, siblingOrder } } };
}
/** Pure candidate planning: no Yjs writes, IDs are allocated once by the caller. */
export function planBoardMindmap(objects: readonly WhiteboardObject[], input: MindmapAction): MindmapPlan {
  const byId = new Map(objects.map(object => [object.id, structuredClone(object)]));
  const commands: WhiteboardCommand[] = [];
  let treeId: string, selectedId: string | null;
  const create = (object: WhiteboardObject) => { if (byId.has(object.id)) throw new Error('MINDMAP_ID_EXISTS'); byId.set(object.id, object); commands.push({ type: 'create', object }); };
  const changeMeta = (object: WhiteboardObject, value: unknown) => { object.extensionData = { ...object.extensionData, mindmap: value }; commands.push({ type: 'extension', id: object.id, key: 'mindmap', value }); };
  if (input.action === 'create-root') {
    treeId = input.id; selectedId = input.id; create(sticky(input.id, treeId, input.text, input.position));
  } else if (input.action === 'import-mermaid') {
    if (input.model.kind !== 'mindmap' || !input.model.nodes.length || input.model.nodes.length > 60) throw new Error('MINDMAP_IMPORT_INVALID');
    const incomingIds = new Set(input.model.edges.map(item => item.target));
    const roots = input.model.nodes.filter(item => !incomingIds.has(item.id));
    if (roots.length !== 1) throw new Error('MINDMAP_IMPORT_ROOT');
    treeId = input.ids[roots[0]!.id]!; selectedId = treeId;
    if (!treeId) throw new Error('MINDMAP_IMPORT_ID');
    for (const item of input.model.nodes) { const id = input.ids[item.id]; if (!id) throw new Error('MINDMAP_IMPORT_ID'); create(sticky(id, treeId, item.label, input.position)); }
    input.model.edges.forEach((item, index) => { const id = input.edgeIds[item.id], from = input.ids[item.source], to = input.ids[item.target]; if (!id || !from || !to) throw new Error('MINDMAP_IMPORT_ID'); create(edge(id, treeId, from, to, index.toString().padStart(8, '0'))); });
  } else {
    const requested = input.action === 'layout' ? input.treeId : input.nodeId;
    const object = byId.get(requested), meta = object && readMindmapMetadata(object);
    if (!object || meta?.role !== 'node') throw new Error('MINDMAP_NODE_REQUIRED');
    treeId = meta.treeId; selectedId = object.id;
    const tree = readMindmapTree([...byId.values()], treeId);
    if ([...tree.nodes.values(), ...tree.edges.values()].some(item => item.locked)) throw new Error('MINDMAP_LOCKED');
    if (input.action === 'add-child' || input.action === 'add-sibling') {
      const parentId = input.action === 'add-child' ? object.id : tree.incoming.get(object.id)?.connector?.from;
      if (!parentId) throw new Error('MINDMAP_ROOT_SIBLING');
      const parent = byId.get(parentId)!;
      const parentMeta = readMindmapMetadata(parent)!;
      if (parentMeta.role === 'node' && parentMeta.collapsed) changeMeta(parent, metadata(treeId, false));
      const children = [...(tree.children.get(parentId) ?? [])];
      const index = input.action === 'add-sibling' ? children.indexOf(object.id) + 1 : children.length;
      children.splice(index, 0, input.id);
      create(sticky(input.id, treeId, input.text, parent.geometry, parent));
      create(edge(input.edgeId, treeId, parentId, input.id, index.toString().padStart(8, '0')));
      // Dedicated sibling keys are rebalanced in this same atomic operation.
      children.forEach((id, order) => {
        const old = id === input.id ? byId.get(input.edgeId)! : tree.incoming.get(id)!;
        const oldMeta = readMindmapMetadata(old)!;
        const key = order.toString().padStart(8, '0');
        if (oldMeta.role === 'edge' && oldMeta.siblingOrder !== key) changeMeta(old, { ...oldMeta, siblingOrder: key });
      }); selectedId = input.id;
    } else if (input.action === 'reparent') {
      const parent = byId.get(input.newParentId), parentMeta = parent && readMindmapMetadata(parent);
      if (!parent || parentMeta?.role !== 'node' || parentMeta.treeId !== treeId || object.id === treeId) throw new Error('MINDMAP_REPARENT_INVALID');
      const incoming = tree.incoming.get(object.id)!;
      incoming.connector = { ...incoming.connector!, from: parent.id };
      commands.push({ type: 'connector', id: incoming.id, connector: incoming.connector });
      const incomingMeta = readMindmapMetadata(incoming)!;
      changeMeta(incoming, { ...incomingMeta, siblingOrder: (tree.children.get(parent.id)?.length ?? 0).toString().padStart(8, '0') });
      if (parentMeta.collapsed) changeMeta(parent, metadata(treeId, false));
    } else if (input.action === 'set-collapsed') changeMeta(object, metadata(treeId, input.collapsed));
    else if (input.action === 'delete-subtree') {
      const removed = new Set<string>();
      const visit = (id: string) => { removed.add(id); for (const child of tree.children.get(id) ?? []) visit(child); }; visit(object.id);
      for (const item of byId.values()) if (item.connector && (removed.has(item.connector.from ?? '') || removed.has(item.connector.to ?? ''))) removed.add(item.id);
      for (const id of removed) { if (byId.get(id)?.locked) throw new Error('MINDMAP_LOCKED'); commands.push({ type: 'delete', id }); byId.delete(id); }
      selectedId = tree.incoming.get(object.id)?.connector?.from ?? null;
    }
  }
  if (byId.has(treeId)) {
    const layout = computeMindmapLayout([...byId.values()], treeId);
    for (const [id, geometry] of layout) {
      const object = byId.get(id)!;
      if (object.locked && JSON.stringify(object.geometry) !== JSON.stringify(geometry)) throw new Error('MINDMAP_LOCKED');
      if (JSON.stringify(object.geometry) !== JSON.stringify(geometry)) commands.push({ type: 'geometry', id, geometry });
    }
  }
  if (!commands.length) { const root = byId.get(treeId)!; commands.push({ type: 'geometry', id: treeId, geometry: root.geometry }); }
  if (commands.length > 200) throw new Error('MINDMAP_OPERATION_LIMIT');
  return { action: input.action, treeId, selectedId, commands };
}

/** A narrow central drop zone previews explicit tree reparenting, not free movement. */
export function mindmapReparentTarget(objects: readonly WhiteboardObject[], id: string, geometry: WhiteboardObject['geometry']): string|null {
  const object=objects.find(object=>object.id===id),meta=object&&readMindmapMetadata(object);
  if(!object||meta?.role!=='node'||id===meta.treeId)return null;
  const tree=readMindmapTree(objects,meta.treeId),excluded=new Set<string>();
  const visit=(id:string)=>{excluded.add(id);for(const child of tree.children.get(id)??[])visit(child);};visit(id);
  const x=geometry.x+geometry.width/2,y=geometry.y+geometry.height/2;
  for(const candidate of tree.nodes.values()){
    if(excluded.has(candidate.id)||candidate.locked||candidate.id===tree.incoming.get(id)?.connector?.from)continue;
    const g=candidate.geometry;
    if(x>=g.x+g.width*0.25&&x<=g.x+g.width*0.75&&y>=g.y+g.height*0.25&&y<=g.y+g.height*0.75)return candidate.id;
  }
  return null;
}
