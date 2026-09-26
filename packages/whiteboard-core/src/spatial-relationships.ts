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
  from?: string;
  to?: string;
  fromPoint?: { x: number; y: number };
  toPoint?: { x: number; y: number };
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

export interface SpatialTransformItem {
  id: string;
  geometry: WhiteboardGeometry;
  parentId?: string | null;
}

export type SpatialCommand =
  | { type: 'create-panel'; id: string; geometry: WhiteboardGeometry; text?: string; parentId?: string | null; orderKey?: string; zIndex?: number; panel: PanelMetadata }
  | { type: 'update-panel'; id: string; panel: PanelMetadata; text?: string }
  | { type: 'arrange-panel'; id: string }
  | { type: 'reparent'; id: string; parentId: string | null; orderKey?: string }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'resize'; id: string; width: number; height: number }
  | { type: 'transform'; items: SpatialTransformItem[] }
  | { type: 'delete-panel'; id: string; children: 'preserve' | 'cascade' }
  | { type: 'duplicate-subgraph'; rootIds: string[]; newIds: Record<string, string>; offset?: { x: number; y: number } }
  | { type: 'group'; id: string; objectIds: string[]; orderKey?: string; zIndex?: number }
  | { type: 'ungroup'; id: string }
  | { type: 'layer'; objectIds: string[]; action: LayerAction }
  | { type: 'set-locked'; objectIds: string[]; locked: boolean }
  | { type: 'create-connector'; id: string; relationship: ConnectorRelationship; zIndex?: number }
  | { type: 'update-connector'; id: string; relationship: ConnectorRelationship }
  | { type: 'delete-object'; id: string; connectors?: 'cascade' | 'preserve-free' }
  | { type: 'delete-objects'; ids: string[]; connectors?: 'cascade' | 'preserve-free' };

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
  const validPoint = (point: unknown) => Boolean(point && typeof point === 'object' && Number.isFinite((point as { x?: unknown }).x) && Number.isFinite((point as { y?: unknown }).y));
  if (Boolean(input.from) === validPoint(input.fromPoint) || Boolean(input.to) === validPoint(input.toPoint)
    || !['top', 'right', 'bottom', 'left', 'center'].includes(input.fromAnchor)
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

function relationshipPoint(snapshot: Snapshot, value: ConnectorRelationship, end: 'from' | 'to', proposed = new Map<string, WhiteboardObject>()): { x: number; y: number } {
  const id = value[end];
  if (!id) return structuredClone(value[end === 'from' ? 'fromPoint' : 'toPoint']!);
  const target = proposed.get(id) ?? object(snapshot, id);
  return anchorPoint(target, value[end === 'from' ? 'fromAnchor' : 'toAnchor']);
}

function relationshipGeometry(snapshot: Snapshot, value: ConnectorRelationship, proposed = new Map<string, WhiteboardObject>()): WhiteboardGeometry {
  const start = relationshipPoint(snapshot, value, 'from', proposed), end = relationshipPoint(snapshot, value, 'to', proposed);
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

function within(child: WhiteboardGeometry, parent: WhiteboardGeometry): boolean {
  const childAngle = child.rotation * Math.PI / 180;
  const parentAngle = -parent.rotation * Math.PI / 180;
  const corners = [[0, 0], [child.width, 0], [0, child.height], [child.width, child.height]];
  return corners.every(([localX = 0, localY = 0]) => {
    const worldX = child.x + localX * Math.cos(childAngle) - localY * Math.sin(childAngle);
    const worldY = child.y + localX * Math.sin(childAngle) + localY * Math.cos(childAngle);
    const dx = worldX - parent.x, dy = worldY - parent.y;
    const x = dx * Math.cos(parentAngle) - dy * Math.sin(parentAngle);
    const y = dx * Math.sin(parentAngle) + dy * Math.cos(parentAngle);
    return x >= 0 && x <= parent.width && y >= 0 && y <= parent.height;
  });
}

function event(type: SpatialEvent['type'], ids: string[]): Omit<SpatialEvent, 'operationId'> {
  return { type, objectIds: [...new Set(ids)] };
}

function deleteObjects(snapshot: Snapshot, ids: readonly string[], connectorPolicy: 'cascade' | 'preserve-free') {
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('DELETE_SELECTION_INVALID');
  const targets = ids.map(id => object(snapshot, id));
  ensureUnlocked(...targets);
  const selected = new Set(ids);
  for (const target of targets) if (children(snapshot, target.id).some(child => !selected.has(child.id))) throw new Error('CONTAINER_NOT_EMPTY');
  const attached = snapshot.objects.filter(item => item.connector && !selected.has(item.id)
    && ((item.connector.from && selected.has(item.connector.from)) || (item.connector.to && selected.has(item.connector.to))));
  ensureUnlocked(...attached);
  const commands: WhiteboardCommand[] = [];
  if (connectorPolicy === 'cascade') {
    commands.push(...attached.map(item => ({ type: 'delete' as const, id: item.id })));
  } else {
    for (const item of attached) {
      const value = normalizeConnector(item.connector!);
      if (value.from && selected.has(value.from)) { const endpoint = object(snapshot, value.from); delete value.from; value.fromPoint = anchorPoint(endpoint, value.fromAnchor); }
      if (value.to && selected.has(value.to)) { const endpoint = object(snapshot, value.to); delete value.to; value.toPoint = anchorPoint(endpoint, value.toAnchor); }
      commands.push({ type: 'connector', id: item.id, connector: value });
    }
  }
  const deletedConnectorIds = new Set([...targets.filter(item => item.kind === 'connector').map(item => item.id), ...attached.filter(() => connectorPolicy === 'cascade').map(item => item.id)]);
  commands.push(...targets.filter(item => item.kind === 'connector').map(item => ({ type: 'delete' as const, id: item.id })));
  const depth = (item: WhiteboardObject) => { let count = 0, parent = item.parentId; while (parent && selected.has(parent)) { count++; parent = snapshot.byId.get(parent)?.parentId ?? null; } return count; };
  commands.push(...targets.filter(item => item.kind !== 'connector').sort((a, b) => depth(b) - depth(a)).map(item => ({ type: 'delete' as const, id: item.id })));
  const deletedIds = [...ids, ...deletedConnectorIds];
  return {
    commands,
    events: [
      event('ObjectDeleted', deletedIds),
      ...(connectorPolicy === 'preserve-free'
        ? attached.map(item => event('ConnectorUpdated', [item.id]))
        : []),
    ],
  };
}

function build(snapshot: Snapshot, command: SpatialCommand): { commands: WhiteboardCommand[]; events: Omit<SpatialEvent, 'operationId'>[] } {
  if (command.type === 'create-panel') {
    const panel = parsePanelMetadata(command.panel);
    return { commands: [{ type: 'create', object: { id: command.id, schemaVersion: 1, kind: 'frame', geometry: command.geometry, text: command.text ?? '', style: {}, parentId: command.parentId ?? null, orderKey: command.orderKey ?? '', locked: false, zIndex: command.zIndex ?? 0, extensionData: panelExtension(undefined, panel) } }], events: [event('PanelCreated', [command.id])] };
  }
  if (command.type === 'update-panel') {
    const target = object(snapshot, command.id); ensureUnlocked(target); readPanelMetadata(target);
    if (command.text !== undefined && (typeof command.text !== 'string' || command.text.length > 20000)) throw new Error('PANEL_TITLE_INVALID');
    const previousMetadata = readPanelMetadata(target)!;
    const metadata = parsePanelMetadata(command.panel), items = children(snapshot, target.id);
    const layoutChanged = JSON.stringify(previousMetadata) !== JSON.stringify(metadata);
    if (layoutChanged) ensureUnlocked(...items);
    const placements = layoutChanged ? arrangedGeometry(target, metadata, items) : new Map<string, WhiteboardGeometry>();
    const commands: WhiteboardCommand[] = [
      { type: 'extension', id: target.id, extensionData: panelExtension(target.extensionData, metadata) },
      ...(command.text !== undefined && command.text !== target.text ? [{ type: 'text' as const, id: target.id, index: 0, deleteCount: target.text.length, insert: command.text }] : []),
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
      if (!(connector.connector!.from && movedIds.has(connector.connector!.from)) && !(connector.connector!.to && movedIds.has(connector.connector!.to))) continue;
      ensureUnlocked(connector);
      const value = normalizeConnector(connector.connector!);
      const geometry = relationshipGeometry(snapshot, value, proposed);
      const existing = commands.find(candidate => candidate.type === 'geometry' && candidate.id === connector.id);
      if (existing && existing.type === 'geometry') existing.geometry = geometry;
      else commands.push({ type: 'geometry', id: connector.id, geometry });
    }
    return { commands, events: [event('ObjectMoved', moved.map(item => item.id))] };
  }
  if (command.type === 'transform') {
    if (!command.items.length || new Set(command.items.map(item => item.id)).size !== command.items.length) throw new Error('TRANSFORM_SELECTION_INVALID');
    const targets = command.items.map(item => object(snapshot, item.id));
    ensureUnlocked(...targets);
    const proposed = new Map<string, WhiteboardObject>();
    for (const [index, target] of targets.entries()) {
      const item = command.items[index]!;
      const geometry = item.geometry;
      if (![geometry.x, geometry.y, geometry.width, geometry.height, geometry.rotation].every(Number.isFinite) || geometry.width <= 0 || geometry.height <= 0) throw new Error('GEOMETRY_INVALID');
      const parentId = item.parentId === undefined ? target.parentId : item.parentId;
      if (parentId) {
        const parent = object(snapshot, parentId); ensureUnlocked(parent);
        if (!['frame', 'group'].includes(parent.kind)) throw new Error('INVALID_PARENT');
        let cursor: string | null = parent.id;
        while (cursor) { if (cursor === target.id) throw new Error('PARENT_CYCLE'); cursor = snapshot.byId.get(cursor)?.parentId ?? null; }
      }
      proposed.set(target.id, { ...target, geometry: structuredClone(geometry), parentId });
      if (['frame', 'group'].includes(target.kind)) {
        const dx = geometry.x - target.geometry.x, dy = geometry.y - target.geometry.y;
        const explicit = new Set(command.items.map(candidate => candidate.id));
        const nested = descendants(snapshot, [target.id]).filter(candidate => candidate.id !== target.id && !explicit.has(candidate.id));
        ensureUnlocked(...nested);
        for (const child of nested) proposed.set(child.id, { ...child, geometry: { ...child.geometry, x: child.geometry.x + dx, y: child.geometry.y + dy } });
      }
    }
    const commands: WhiteboardCommand[] = [];
    for (const next of proposed.values()) {
      const target = object(snapshot, next.id);
      if (!geometryEqual(target.geometry, next.geometry)) commands.push({ type: 'geometry', id: target.id, geometry: next.geometry });
      if (target.parentId !== next.parentId) commands.push({ type: 'parent', id: target.id, parentId: next.parentId, orderKey: target.orderKey });
    }
    for (const connector of snapshot.objects.filter(item => item.kind === 'connector' && item.connector)) {
      const value = normalizeConnector(connector.connector!);
      if (!(value.from && proposed.has(value.from)) && !(value.to && proposed.has(value.to))) continue;
      ensureUnlocked(connector);
      commands.push({ type: 'geometry', id: connector.id, geometry: relationshipGeometry(snapshot, value, proposed) });
    }
    const affectedPanels = new Set([...proposed.values()].map(item => item.parentId).filter((id): id is string => Boolean(id)));
    for (const panelId of affectedPanels) {
      const panel = proposed.get(panelId) ?? object(snapshot, panelId), metadata = readPanelMetadata(panel);
      if (!metadata) continue;
      const panelItems = snapshot.objects.filter(item => (proposed.get(item.id) ?? item).parentId === panelId).map(item => proposed.get(item.id) ?? item);
      if (metadata.clipContent && panelItems.some(item => !within(item.geometry, panel.geometry))) throw new Error('PARENT_BOUNDS_EXCEEDED');
      const expanded = expandedPanelGeometry(panel, metadata, panelItems);
      if (expanded && !geometryEqual(expanded, panel.geometry)) commands.push({ type: 'geometry', id: panel.id, geometry: expanded });
    }
    if (!commands.length) throw new Error('NO_SPATIAL_CHANGE');
    return { commands, events: [event('ObjectMoved', targets.map(item => item.id))] };
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
      const attached = snapshot.objects.filter(item => item.connector && ((item.connector.from && ids.has(item.connector.from)) || (item.connector.to && ids.has(item.connector.to))));
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
    for (const edge of snapshot.objects) {
      if (!edge.connector) continue;
      const attachedIds = [edge.connector.from, edge.connector.to].filter((id): id is string => Boolean(id));
      if (attachedIds.length > 0 && attachedIds.every(id => chosenIds.has(id))) chosenIds.add(edge.id);
    }
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
    const selected = new Set(items.map(item => item.id));
    const ordered = [...snapshot.objects].sort((a, b) => layerOf(a) - layerOf(b) || a.id.localeCompare(b.id));
    const block = ordered.filter(item => selected.has(item.id)), rest = ordered.filter(item => !selected.has(item.id));
    const originalFirst = Math.min(...block.map(item => ordered.indexOf(item)));
    let insertion = command.action === 'bring-to-front' ? rest.length : command.action === 'send-to-back' ? 0
      : command.action === 'bring-forward' ? Math.min(rest.length, originalFirst + 1) : Math.max(0, originalFirst - 1);
    const next = [...rest.slice(0, insertion), ...block, ...rest.slice(insertion)];
    const assigned = new Map<string, number>();
    const lockedAnchors = next.map((item, index) => ({ item, index })).filter(({ item }) => item.locked && !selected.has(item.id));
    if (!lockedAnchors.length) next.forEach((item, index) => assigned.set(item.id, index));
    else {
      const first = lockedAnchors[0]!, before = next.slice(0, first.index);
      before.forEach((item, index) => assigned.set(item.id, layerOf(first.item) - before.length + index));
      assigned.set(first.item.id, layerOf(first.item));
      for (let anchorIndex = 1; anchorIndex < lockedAnchors.length; anchorIndex++) {
        const previous = lockedAnchors[anchorIndex - 1]!, current = lockedAnchors[anchorIndex]!;
        const between = next.slice(previous.index + 1, current.index);
        if (layerOf(current.item) - layerOf(previous.item) - 1 < between.length) throw new Error('LAYER_LOCKED_ORDER_CONFLICT');
        between.forEach((item, index) => assigned.set(item.id, layerOf(previous.item) + index + 1));
        assigned.set(current.item.id, layerOf(current.item));
      }
      const last = lockedAnchors.at(-1)!, after = next.slice(last.index + 1);
      after.forEach((item, index) => assigned.set(item.id, layerOf(last.item) + index + 1));
    }
    const commands: WhiteboardCommand[] = next.filter(item => !item.locked && layerOf(item) !== assigned.get(item.id)).map(item => ({ type: 'state', id: item.id, zIndex: assigned.get(item.id)! }));
    if (!commands.length) commands.push({ type: 'state', id: items[0]!.id, zIndex: layerOf(items[0]!) });
    return { commands, events: [event('ObjectsLayered', items.map(item => item.id))] };
  }
  if (command.type === 'set-locked') {
    const items = command.objectIds.map(id => object(snapshot, id));
    if (!items.length) throw new Error('LOCK_SELECTION_INVALID');
    return { commands: items.map(item => ({ type: 'state', id: item.id, locked: command.locked })), events: [event('ObjectsLocked', items.map(item => item.id))] };
  }
  if (command.type === 'create-connector') {
    const value = relation(command.relationship), from = value.from ? object(snapshot, value.from) : null, to = value.to ? object(snapshot, value.to) : null; ensureUnlocked(...[from, to].filter((item): item is WhiteboardObject => Boolean(item)));
    if (from?.kind === 'connector' || to?.kind === 'connector' || (from && to && from.id === to.id)) throw new Error('CONNECTOR_ENDPOINT_INVALID');
    return { commands: [{ type: 'create', object: { id: command.id, schemaVersion: 1, kind: 'connector', geometry: relationshipGeometry(snapshot, value), text: value.label, style: {}, parentId: null, orderKey: '', locked: false, zIndex: command.zIndex ?? Math.max(from ? layerOf(from) : 0, to ? layerOf(to) : 0) + 1, connector: value } }], events: [event('ConnectorCreated', [command.id])] };
  }
  if (command.type === 'update-connector') {
    const target = object(snapshot, command.id); ensureUnlocked(target);
    if (target.kind !== 'connector') throw new Error('CONNECTOR_KIND_REQUIRED');
    const value = relation(command.relationship), from = value.from ? object(snapshot, value.from) : null, to = value.to ? object(snapshot, value.to) : null;
    if (from?.kind === 'connector' || to?.kind === 'connector' || (from && to && from.id === to.id)) throw new Error('CONNECTOR_ENDPOINT_INVALID');
    return { commands: [{ type: 'connector', id: target.id, connector: value }, { type: 'geometry', id: target.id, geometry: relationshipGeometry(snapshot, value) }, { type: 'text', id: target.id, index: 0, deleteCount: target.text.length, insert: value.label }], events: [event('ConnectorUpdated', [target.id])] };
  }
  if (command.type === 'delete-objects') return deleteObjects(snapshot, command.ids, command.connectors ?? 'cascade');
  return deleteObjects(snapshot, [command.id], command.connectors ?? 'cascade');
}

function normalizeConnector(value: NonNullable<WhiteboardObject['connector']>): ConnectorRelationship {
  return relation({ ...(value.from ? { from: value.from } : { fromPoint: value.fromPoint! }), ...(value.to ? { to: value.to } : { toPoint: value.toPoint! }), fromAnchor: value.fromAnchor ?? 'right', toAnchor: value.toAnchor ?? 'left', type: value.type ?? 'straight', startStyle: value.startStyle ?? 'none', endStyle: value.endStyle ?? 'arrow', lineStyle: value.lineStyle ?? 'solid', label: value.label ?? '', semanticRelation: value.semanticRelation ?? '' });
}

function copyObjectsForSnapshot(snapshot: Snapshot, ids: string[], newId: (oldId: string) => string): WhiteboardObject[] {
  // Mirror the public copy reference-remapping semantics without constructing a temporary Y.Doc.
  const selected = snapshot.objects.filter(item => ids.includes(item.id));
  const mapping = new Map(selected.map(item => [item.id, newId(item.id)]));
  if (new Set(mapping.values()).size !== mapping.size) throw new Error('DUPLICATE_COPY_ID');
  return selected.filter(item => !item.connector || ((!item.connector.from || mapping.has(item.connector.from)) && (!item.connector.to || mapping.has(item.connector.to)))).map(item => ({
    ...structuredClone(item), id: mapping.get(item.id)!, parentId: item.parentId ? mapping.get(item.parentId) ?? null : null,
    ...(item.connector ? { connector: { ...structuredClone(item.connector), ...(item.connector.from ? { from: mapping.get(item.connector.from)! } : {}), ...(item.connector.to ? { to: mapping.get(item.connector.to)! } : {}) } } : {}),
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
    if (!accepted) throw new Error('SPATIAL_COMMAND_REJECTED');
    const result = { ...accepted, events: built.events.map(value => ({ ...value, operationId: accepted.operationId })) };
    this.accepted.set(key, { payload, result: structuredClone(result) });
    return result;
  }
}
