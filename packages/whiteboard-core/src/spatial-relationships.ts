import type * as Y from 'yjs';
import type { WhiteboardCommand, WhiteboardGeometry, WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { BoardCommandPort, type BoardCommandAccepted } from './command-port';
import { readObjects } from './document';
import { panelExtension, parsePanelMetadata, readPanelMetadata, type PanelMetadata } from './spatial-model';

export type LayerAction = 'bring-forward' | 'bring-to-front' | 'send-backward' | 'send-to-back';
export type ConnectorAnchor = 'top' | 'right' | 'bottom' | 'left' | 'center';
export type ConnectorType = 'straight' | 'elbow' | 'curve';
export type ConnectorTip = 'none' | 'arrow' | 'circle' | 'diamond';
export type ConnectorLineStyle = 'solid' | 'dashed' | 'dotted';

export interface ConnectorRelationship {
  from: string;
  to: string;
  fromAnchor: ConnectorAnchor;
  toAnchor: ConnectorAnchor;
  type: ConnectorType;
  startStyle: ConnectorTip;
  endStyle: ConnectorTip;
  lineStyle: ConnectorLineStyle;
  label: string;
  semanticRelation: string;
}

export interface SpatialPrecondition {
  id: string;
  parentId?: string | null;
  locked?: boolean;
  geometry?: WhiteboardGeometry;
}

export type SpatialCommand =
  | { type: 'create-panel'; id: string; geometry: WhiteboardGeometry; text?: string; parentId?: string | null; orderKey?: string; zIndex?: number; panel: PanelMetadata }
  | { type: 'update-panel'; id: string; panel: PanelMetadata }
  | { type: 'arrange-panel'; id: string }
  | { type: 'reparent'; id: string; parentId: string | null; orderKey?: string }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'resize'; id: string; width: number; height: number }
  | { type: 'delete-panel'; id: string; children: 'preserve' | 'cascade' }
  | { type: 'duplicate-subgraph'; rootIds: string[]; newIds: Record<string, string>; offset?: { x: number; y: number } }
  | { type: 'group'; id: string; objectIds: string[]; orderKey?: string; zIndex?: number }
  | { type: 'ungroup'; id: string }
  | { type: 'layer'; objectIds: string[]; action: LayerAction }
  | { type: 'set-locked'; objectIds: string[]; locked: boolean }
  | { type: 'create-connector'; id: string; relationship: ConnectorRelationship; zIndex?: number }
  | { type: 'update-connector'; id: string; relationship: ConnectorRelationship }
  | { type: 'delete-object'; id: string };

export interface SpatialCommandEnvelope {
  boardId: string;
  clientId: string;
  gestureId: string;
  command: SpatialCommand;
  preconditions?: SpatialPrecondition[];
}

export interface SpatialEvent {
  type: 'PanelCreated' | 'PanelUpdated' | 'ObjectsArranged' | 'ObjectReparented' | 'ObjectMoved' | 'ObjectResized'
    | 'ObjectDeleted' | 'ObjectsDuplicated' | 'ObjectsGrouped' | 'ObjectsUngrouped' | 'ObjectsLayered'
    | 'ObjectsLocked' | 'ConnectorCreated' | 'ConnectorUpdated';
  operationId: string;
  objectIds: string[];
}

export interface SpatialCommandAccepted extends BoardCommandAccepted { events: SpatialEvent[]; }

type Snapshot = ReturnType<typeof snapshot>;
type Accepted = { payload: string; result: SpatialCommandAccepted };
const acceptedByDocument = new WeakMap<Y.Doc, Map<string, Accepted>>();

function snapshot(doc: Y.Doc) {
  const objects = readObjects(doc);
  return { objects, byId: new Map(objects.map(object => [object.id, object])) };
}

function object(snapshot: Snapshot, id: string): WhiteboardObject {
  const result = snapshot.byId.get(id);
  if (!result) throw new Error('OBJECT_NOT_FOUND');
  return result;
}

function ensureUnlocked(...objects: WhiteboardObject[]): void {
  if (objects.some(value => value.locked)) throw new Error('OBJECT_LOCKED');
}

function layerOf(value: WhiteboardObject): number { return value.zIndex ?? 0; }

function children(snapshot: Snapshot, id: string): WhiteboardObject[] {
  return snapshot.objects.filter(value => value.parentId === id);
}

function descendants(snapshot: Snapshot, roots: readonly string[]): WhiteboardObject[] {
  const selected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const value of snapshot.objects) if (value.parentId && selected.has(value.parentId) && !selected.has(value.id)) {
      selected.add(value.id); changed = true;
    }
  }
  return snapshot.objects.filter(value => selected.has(value.id));
}

function relation(input: ConnectorRelationship): ConnectorRelationship {
  if (!input || typeof input !== 'object') throw new Error('CONNECTOR_INVALID');
  if (!['top', 'right', 'bottom', 'left', 'center'].includes(input.fromAnchor)
    || !['top', 'right', 'bottom', 'left', 'center'].includes(input.toAnchor)
    || !['straight', 'elbow', 'curve'].includes(input.type)
    || !['none', 'arrow', 'circle', 'diamond'].includes(input.startStyle)
    || !['none', 'arrow', 'circle', 'diamond'].includes(input.endStyle)
    || !['solid', 'dashed', 'dotted'].includes(input.lineStyle)
    || typeof input.label !== 'string' || input.label.length > 1000
    || typeof input.semanticRelation !== 'string' || input.semanticRelation.length > 256) throw new Error('CONNECTOR_INVALID');
  return structuredClone(input);
}

function anchorPoint(value: WhiteboardObject, anchor: ConnectorAnchor): { x: number; y: number } {
  const { x, y, width, height } = value.geometry;
  if (anchor === 'top') return { x: x + width / 2, y };
  if (anchor === 'right') return { x: x + width, y: y + height / 2 };
  if (anchor === 'bottom') return { x: x + width / 2, y: y + height };
  if (anchor === 'left') return { x, y: y + height / 2 };
  return { x: x + width / 2, y: y + height / 2 };
}

function connectorGeometry(from: WhiteboardObject, to: WhiteboardObject, value: ConnectorRelationship): WhiteboardGeometry {
  const start = anchorPoint(from, value.fromAnchor), end = anchorPoint(to, value.toAnchor);
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.max(1, Math.abs(end.x - start.x)), height: Math.max(1, Math.abs(end.y - start.y)), rotation: 0 };
}

function arrangedGeometry(panel: WhiteboardObject, metadata: PanelMetadata, items: WhiteboardObject[]): Map<string, WhiteboardGeometry> {
  const result = new Map<string, WhiteboardGeometry>();
  if (metadata.mode === 'freeform') return result;
  let x = panel.geometry.x + metadata.padding, y = panel.geometry.y + metadata.padding;
  items.sort((a, b) => a.orderKey.localeCompare(b.orderKey) || a.id.localeCompare(b.id));
  if (metadata.mode === 'grid') {
    let rowHeight = 0;
    items.forEach((item, index) => {
      if (index > 0 && index % metadata.columns === 0) { x = panel.geometry.x + metadata.padding; y += rowHeight + metadata.gap; rowHeight = 0; }
      result.set(item.id, { ...item.geometry, x, y }); x += item.geometry.width + metadata.gap; rowHeight = Math.max(rowHeight, item.geometry.height);
    });
  } else {
    for (const item of items) {
      result.set(item.id, { ...item.geometry, x, y });
      if (metadata.flowDirection === 'horizontal') x += item.geometry.width + metadata.gap;
      else y += item.geometry.height + metadata.gap;
    }
  }
  return result;
}

function expandedPanelGeometry(panel: WhiteboardObject, metadata: PanelMetadata, items: WhiteboardObject[]): WhiteboardGeometry | null {
  if (!metadata.autoExpand || metadata.clipContent || items.length === 0) return null;
  const left = Math.min(panel.geometry.x, ...items.map(item => item.geometry.x - metadata.padding));
  const top = Math.min(panel.geometry.y, ...items.map(item => item.geometry.y - metadata.padding));
  const right = Math.max(panel.geometry.x + panel.geometry.width, ...items.map(item => item.geometry.x + item.geometry.width + metadata.padding));
  const bottom = Math.max(panel.geometry.y + panel.geometry.height, ...items.map(item => item.geometry.y + item.geometry.height + metadata.padding));
  return { ...panel.geometry, x: left, y: top, width: right - left, height: bottom - top };
}

function geometryEqual(a: WhiteboardGeometry, b: WhiteboardGeometry): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation;
}

function event(type: SpatialEvent['type'], ids: string[]): Omit<SpatialEvent, 'operationId'> {
  return { type, objectIds: [...new Set(ids)] };
}

function build(snapshot: Snapshot, command: SpatialCommand): { commands: WhiteboardCommand[]; events: Omit<SpatialEvent, 'operationId'>[] } {
  if (command.type === 'create-panel') {
    const panel = parsePanelMetadata(command.panel);
    return { commands: [{ type: 'create', object: { id: command.id, schemaVersion: 1, kind: 'frame', geometry: command.geometry, text: command.text ?? '', style: {}, parentId: command.parentId ?? null, orderKey: command.orderKey ?? '', locked: false, zIndex: command.zIndex ?? 0, extensionData: panelExtension(undefined, panel) } }], events: [event('PanelCreated', [command.id])] };
  }
  if (command.type === 'update-panel') {
    const target = object(snapshot, command.id); ensureUnlocked(target); readPanelMetadata(target);
    const metadata = parsePanelMetadata(command.panel), items = children(snapshot, target.id); ensureUnlocked(...items);
    const placements = arrangedGeometry(target, metadata, items);
    const commands: WhiteboardCommand[] = [
      { type: 'extension', id: target.id, extensionData: panelExtension(target.extensionData, metadata) },
      ...[...placements].map(([id, geometry]) => ({ type: 'geometry' as const, id, geometry })),
    ];
    const projected = items.map(item => ({ ...item, geometry: placements.get(item.id) ?? item.geometry }));
    const expanded = expandedPanelGeometry(target, metadata, projected);
    if (expanded && !geometryEqual(expanded, target.geometry)) commands.push({ type: 'geometry', id: target.id, geometry: expanded });
    return { commands, events: [event('PanelUpdated', [target.id]), ...(placements.size ? [event('ObjectsArranged', items.map(item => item.id))] : [])] };
  }
  if (command.type === 'arrange-panel') {
    const panel = object(snapshot, command.id), metadata = readPanelMetadata(panel); ensureUnlocked(panel);
    if (!metadata) throw new Error('PANEL_REQUIRED');
    const items = children(snapshot, panel.id); ensureUnlocked(...items);
    const placements = arrangedGeometry(panel, metadata, items);
    const commands: WhiteboardCommand[] = [...placements].map(([id, geometry]) => ({ type: 'geometry', id, geometry }));
    const projected = items.map(item => ({ ...item, geometry: placements.get(item.id) ?? item.geometry }));
    const expanded = expandedPanelGeometry(panel, metadata, projected);
    if (expanded && !geometryEqual(expanded, panel.geometry)) commands.push({ type: 'geometry', id: panel.id, geometry: expanded });
    if (!commands.length) throw new Error('NO_SPATIAL_CHANGE');
    return { commands, events: [event('ObjectsArranged', [panel.id, ...items.map(item => item.id)])] };
  }
  if (command.type === 'reparent') {
    const target = object(snapshot, command.id); ensureUnlocked(target);
    const parent = command.parentId ? object(snapshot, command.parentId) : null;
    if (parent && !['frame', 'group'].includes(parent.kind)) throw new Error('INVALID_PARENT');
    if (parent) ensureUnlocked(parent);
    const commands: WhiteboardCommand[] = [{ type: 'parent', id: target.id, parentId: parent?.id ?? null, orderKey: command.orderKey ?? target.orderKey }];
    if (parent?.kind === 'frame') {
      const metadata = readPanelMetadata(parent);
      if (metadata) {
        const items = [...children(snapshot, parent.id).filter(item => item.id !== target.id), target];
        const placements = arrangedGeometry(parent, metadata, items);
        commands.push(...[...placements].map(([id, geometry]) => ({ type: 'geometry' as const, id, geometry })));
        const projected = items.map(item => ({ ...item, geometry: placements.get(item.id) ?? item.geometry }));
        const expanded = expandedPanelGeometry(parent, metadata, projected);
        if (expanded && !geometryEqual(expanded, parent.geometry)) commands.push({ type: 'geometry', id: parent.id, geometry: expanded });
      }
    }
    return { commands, events: [event('ObjectReparented', [target.id])] };
  }
  if (command.type === 'move') {
    const target = object(snapshot, command.id), moved = ['frame', 'group'].includes(target.kind) ? descendants(snapshot, [target.id]) : [target];
    ensureUnlocked(...moved);
    const dx = command.x - target.geometry.x, dy = command.y - target.geometry.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('GEOMETRY_INVALID');
    const proposed = new Map(moved.map(item => [item.id, { ...item, geometry: { ...item.geometry, x: item.geometry.x + dx, y: item.geometry.y + dy } }]));
    const commands: WhiteboardCommand[] = moved.map(item => ({ type: 'geometry', id: item.id, geometry: proposed.get(item.id)!.geometry }));
    const movedIds = new Set(moved.map(item => item.id));
    for (const connector of snapshot.objects.filter(item => item.connector && item.kind === 'connector')) {
      if (!movedIds.has(connector.connector!.from) && !movedIds.has(connector.connector!.to)) continue;
      ensureUnlocked(connector);
      const value = normalizeConnector(connector.connector!);
      const from = proposed.get(value.from) ?? object(snapshot, value.from), to = proposed.get(value.to) ?? object(snapshot, value.to);
      const geometry = connectorGeometry(from, to, value);
      const existing = commands.find(candidate => candidate.type === 'geometry' && candidate.id === connector.id);
      if (existing && existing.type === 'geometry') existing.geometry = geometry;
      else commands.push({ type: 'geometry', id: connector.id, geometry });
    }
    return { commands, events: [event('ObjectMoved', moved.map(item => item.id))] };
  }
  if (command.type === 'resize') {
    const target = object(snapshot, command.id); ensureUnlocked(target);
    return { commands: [{ type: 'geometry', id: target.id, geometry: { ...target.geometry, width: command.width, height: command.height } }], events: [event('ObjectResized', [target.id])] };
  }
  if (command.type === 'delete-panel') {
    const panel = object(snapshot, command.id); ensureUnlocked(panel);
    if (panel.kind !== 'frame') throw new Error('PANEL_REQUIRED');
    const commands: WhiteboardCommand[] = [];
    if (command.children === 'preserve') {
      const direct = children(snapshot, panel.id); ensureUnlocked(...direct);
      commands.push(...direct.map(item => ({ type: 'parent' as const, id: item.id, parentId: panel.parentId, orderKey: item.orderKey })));
    } else {
      const nested = descendants(snapshot, [panel.id]); ensureUnlocked(...nested);
      const ids = new Set(nested.map(item => item.id));
      const attached = snapshot.objects.filter(item => item.connector && (ids.has(item.connector.from) || ids.has(item.connector.to)));
      const connectorDeletes = [...new Map([...attached, ...nested.filter(item => item.kind === 'connector')].map(item => [item.id, item])).values()];
      ensureUnlocked(...connectorDeletes);
      commands.push(...connectorDeletes.map(item => ({ type: 'delete' as const, id: item.id })));
      const depth = (item: WhiteboardObject) => { let count = 0, parent = item.parentId; while (parent && ids.has(parent)) { count++; parent = snapshot.byId.get(parent)?.parentId ?? null; } return count; };
      commands.push(...nested.filter(item => item.kind !== 'connector').sort((a, b) => depth(b) - depth(a)).map(item => ({ type: 'delete' as const, id: item.id })));
      return { commands, events: [event('ObjectDeleted', [...ids, ...attached.map(item => item.id)])] };
    }
    commands.push({ type: 'delete', id: panel.id });
    return { commands, events: [event('ObjectDeleted', [panel.id])] };
  }
  if (command.type === 'duplicate-subgraph') {
    const chosen = descendants(snapshot, command.rootIds);
    const chosenIds = new Set(chosen.map(item => item.id));
    for (const edge of snapshot.objects) if (edge.connector && chosenIds.has(edge.connector.from) && chosenIds.has(edge.connector.to)) chosenIds.add(edge.id);
    const source = snapshot.objects.filter(item => chosenIds.has(item.id)); ensureUnlocked(...source);
    if (!source.length || source.some(item => !command.newIds[item.id])) throw new Error('DUPLICATE_ID_REQUIRED');
    const copies = copyObjectsForSnapshot(snapshot, [...chosenIds], oldId => command.newIds[oldId]!);
    const offset = command.offset ?? { x: 24, y: 24 };
    for (const item of copies) item.geometry = { ...item.geometry, x: item.geometry.x + offset.x, y: item.geometry.y + offset.y };
    return { commands: copies.map(value => ({ type: 'create', object: value })), events: [event('ObjectsDuplicated', copies.map(item => item.id))] };
  }
  if (command.type === 'group') {
    const items = command.objectIds.map(id => object(snapshot, id)); ensureUnlocked(...items);
    if (items.length < 2 || new Set(items.map(item => item.id)).size !== items.length) throw new Error('GROUP_SELECTION_INVALID');
    const selected = new Set(items.map(item => item.id));
    if (items.some(item => { let parent = item.parentId; while (parent) { if (selected.has(parent)) return true; parent = snapshot.byId.get(parent)?.parentId ?? null; } return false; })) throw new Error('GROUP_SELECTION_INVALID');
    const parentId = items.every(item => item.parentId === items[0]!.parentId) ? items[0]!.parentId : null;
    const left = Math.min(...items.map(item => item.geometry.x)), top = Math.min(...items.map(item => item.geometry.y));
    const right = Math.max(...items.map(item => item.geometry.x + item.geometry.width)), bottom = Math.max(...items.map(item => item.geometry.y + item.geometry.height));
    const group: WhiteboardObject = { id: command.id, schemaVersion: 1, kind: 'group', geometry: { x: left, y: top, width: right - left, height: bottom - top, rotation: 0 }, text: '', style: {}, parentId, orderKey: command.orderKey ?? '', locked: false, zIndex: command.zIndex ?? Math.max(...items.map(layerOf)) };
    return { commands: [{ type: 'create', object: group }, ...items.map(item => ({ type: 'parent' as const, id: item.id, parentId: group.id, orderKey: item.orderKey }))], events: [event('ObjectsGrouped', [group.id, ...items.map(item => item.id)])] };
  }
  if (command.type === 'ungroup') {
    const group = object(snapshot, command.id); ensureUnlocked(group);
    if (group.kind !== 'group') throw new Error('GROUP_REQUIRED');
    const items = children(snapshot, group.id); ensureUnlocked(...items);
    return { commands: [...items.map(item => ({ type: 'parent' as const, id: item.id, parentId: group.parentId, orderKey: item.orderKey })), { type: 'delete', id: group.id }], events: [event('ObjectsUngrouped', [group.id, ...items.map(item => item.id)])] };
  }
  if (command.type === 'layer') {
    const items = command.objectIds.map(id => object(snapshot, id)); ensureUnlocked(...items);
    if (!items.length) throw new Error('LAYER_SELECTION_INVALID');
    const min = Math.min(...snapshot.objects.map(layerOf)), max = Math.max(...snapshot.objects.map(layerOf));
    const ordered = [...items].sort((a, b) => layerOf(a) - layerOf(b) || a.id.localeCompare(b.id));
    const commands = ordered.map((item, index): WhiteboardCommand => ({ type: 'state', id: item.id, zIndex:
      command.action === 'bring-to-front' ? max + index + 1 : command.action === 'send-to-back' ? min - ordered.length + index
        : command.action === 'bring-forward' ? layerOf(item) + 1 : layerOf(item) - 1 }));
    return { commands, events: [event('ObjectsLayered', items.map(item => item.id))] };
  }
  if (command.type === 'set-locked') {
    const items = command.objectIds.map(id => object(snapshot, id));
    if (!items.length) throw new Error('LOCK_SELECTION_INVALID');
    return { commands: items.map(item => ({ type: 'state', id: item.id, locked: command.locked })), events: [event('ObjectsLocked', items.map(item => item.id))] };
  }
  if (command.type === 'create-connector') {
    const value = relation(command.relationship), from = object(snapshot, value.from), to = object(snapshot, value.to); ensureUnlocked(from, to);
    if (from.kind === 'connector' || to.kind === 'connector' || from.id === to.id) throw new Error('CONNECTOR_ENDPOINT_INVALID');
    return { commands: [{ type: 'create', object: { id: command.id, schemaVersion: 1, kind: 'connector', geometry: connectorGeometry(from, to, value), text: value.label, style: {}, parentId: null, orderKey: '', locked: false, zIndex: command.zIndex ?? Math.max(layerOf(from), layerOf(to)) + 1, connector: value } }], events: [event('ConnectorCreated', [command.id])] };
  }
  if (command.type === 'update-connector') {
    const target = object(snapshot, command.id); ensureUnlocked(target);
    if (target.kind !== 'connector') throw new Error('CONNECTOR_KIND_REQUIRED');
    const value = relation(command.relationship), from = object(snapshot, value.from), to = object(snapshot, value.to);
    if (from.kind === 'connector' || to.kind === 'connector' || from.id === to.id) throw new Error('CONNECTOR_ENDPOINT_INVALID');
    return { commands: [{ type: 'connector', id: target.id, connector: value }, { type: 'geometry', id: target.id, geometry: connectorGeometry(from, to, value) }, { type: 'text', id: target.id, index: 0, deleteCount: target.text.length, insert: value.label }], events: [event('ConnectorUpdated', [target.id])] };
  }
  const target = object(snapshot, command.id); ensureUnlocked(target);
  if (children(snapshot, target.id).length) throw new Error('CONTAINER_NOT_EMPTY');
  return { commands: [{ type: 'delete', id: target.id }], events: [event('ObjectDeleted', [target.id])] };
}

function normalizeConnector(value: NonNullable<WhiteboardObject['connector']>): ConnectorRelationship {
  return relation({ from: value.from, to: value.to, fromAnchor: value.fromAnchor ?? 'right', toAnchor: value.toAnchor ?? 'left', type: value.type ?? 'straight', startStyle: value.startStyle ?? 'none', endStyle: value.endStyle ?? 'arrow', lineStyle: value.lineStyle ?? 'solid', label: value.label ?? '', semanticRelation: value.semanticRelation ?? '' });
}

function copyObjectsForSnapshot(snapshot: Snapshot, ids: string[], newId: (oldId: string) => string): WhiteboardObject[] {
  // Mirror the public copy reference-remapping semantics without constructing a temporary Y.Doc.
  const selected = snapshot.objects.filter(item => ids.includes(item.id));
  const mapping = new Map(selected.map(item => [item.id, newId(item.id)]));
  if (new Set(mapping.values()).size !== mapping.size) throw new Error('DUPLICATE_COPY_ID');
  return selected.filter(item => !item.connector || (mapping.has(item.connector.from) && mapping.has(item.connector.to))).map(item => ({
    ...structuredClone(item), id: mapping.get(item.id)!, parentId: item.parentId ? mapping.get(item.parentId) ?? null : null,
    ...(item.connector ? { connector: { ...structuredClone(item.connector), from: mapping.get(item.connector.from)!, to: mapping.get(item.connector.to)! } } : {}),
  }));
}

function verifyPreconditions(snapshot: Snapshot, preconditions: readonly SpatialPrecondition[]): void {
  for (const expected of preconditions) {
    const current = object(snapshot, expected.id);
    if (expected.parentId !== undefined && current.parentId !== expected.parentId) throw new Error('SPATIAL_CONFLICT');
    if (expected.locked !== undefined && current.locked !== expected.locked) throw new Error('SPATIAL_CONFLICT');
    if (expected.geometry && !geometryEqual(current.geometry, expected.geometry)) throw new Error('SPATIAL_CONFLICT');
  }
}

export class SpatialRelationshipCommandPort {
  private readonly accepted: Map<string, Accepted>;
  private readonly commandPort: BoardCommandPort;
  constructor(private readonly doc: Y.Doc) {
    this.commandPort = new BoardCommandPort(doc);
    this.accepted = acceptedByDocument.get(doc) ?? new Map();
    if (!acceptedByDocument.has(doc)) acceptedByDocument.set(doc, this.accepted);
  }

  dispatch(input: SpatialCommandEnvelope): SpatialCommandAccepted {
    const key = JSON.stringify([input?.boardId, input?.clientId, input?.gestureId]);
    const payload = JSON.stringify({ command: input?.command, preconditions: input?.preconditions ?? [] });
    const previous = this.accepted.get(key);
    if (previous) {
      if (previous.payload !== payload) throw new Error('SPATIAL_COMMAND_INVALID');
      return structuredClone(previous.result);
    }
    const current = snapshot(this.doc);
    verifyPreconditions(current, input.preconditions ?? []);
    const built = build(current, input.command);
    const accepted = this.commandPort.dispatch({ boardId: input.boardId, clientId: input.clientId, gestureId: input.gestureId, commands: built.commands });
    const result = { ...accepted, events: built.events.map(value => ({ ...value, operationId: accepted.operationId })) };
    this.accepted.set(key, { payload, result: structuredClone(result) });
    return result;
  }
}
