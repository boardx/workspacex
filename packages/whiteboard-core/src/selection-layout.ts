import * as Y from 'yjs';
import {
  WhiteboardGeometry as WhiteboardGeometrySchema,
  WHITEBOARD_LIMITS,
  WhiteboardLayoutCommand,
  type WhiteboardGeometry,
  type WhiteboardLayoutKind,
  type WhiteboardObject,
} from '@repo/contracts/whiteboard-document';
import { BoardCommandPort, type BoardCommandAccepted } from './command-port';
import { readObjects } from './document';
import { readPanelMetadata } from './spatial-model';

export const DEFAULT_LAYOUT_GAP = 24;

export interface LayoutPrecondition {
  id: string;
  geometry: WhiteboardGeometry;
  parentId?: string | null;
  locked?: boolean;
  hidden?: boolean;
  /** Full canonical state guard. Geometry-only checks permit metadata/endpoints ABA. */
  state: string;
}

export interface SelectionResolution {
  objectIds: string[];
  objects: WhiteboardObject[];
  parentBoundary: 'same-parent' | 'mixed-parent';
  parentId: string | null;
}

export interface LayoutCommandEnvelope {
  boardId: string;
  clientId: string;
  gestureId: string;
  command: WhiteboardLayoutCommand;
  preconditions: LayoutPrecondition[];
  stateVector: Uint8Array;
}

export interface LayoutPreview {
  previewId: string;
  layoutKind: WhiteboardLayoutKind;
  geometries: LayoutGeometryState[];
}

export interface LayoutGeometryState { id: string; geometry: WhiteboardGeometry; }
export interface ObjectsArrangedEvent {
  type: 'ObjectsArranged';
  operationId: string;
  layoutKind: WhiteboardLayoutKind;
  selectionObjectIds: string[];
  objectIds: string[];
  before: LayoutGeometryState[];
  after: LayoutGeometryState[];
}
export interface LayoutCommandAccepted extends BoardCommandAccepted { events: [ObjectsArrangedEvent]; }

export interface SnapGuide {
  axis: 'x' | 'y';
  position: number;
  movingAnchor: 'start' | 'center' | 'end';
  targetAnchor: 'start' | 'center' | 'end';
  targetId: string;
}
export interface SnapMeasurement {
  axis: 'x' | 'y';
  size: number;
  from: number;
  to: number;
  relatedObjectIds: [string, string];
  equalSpacing: boolean;
}
export interface SnapResult {
  geometry: WhiteboardGeometry;
  delta: { x: number; y: number };
  guides: SnapGuide[];
  measurements: SnapMeasurement[];
}

type Snapshot = { objects: WhiteboardObject[]; byId: Map<string, WhiteboardObject> };
type Accepted = { payload: string; result: LayoutCommandAccepted };
const acceptedByDocument = new WeakMap<Y.Doc, Map<string, Accepted>>();

function finite(value: number, code = 'LAYOUT_INVALID'): number {
  if (!Number.isFinite(value)) throw new Error(code);
  return value;
}

function sameGeometry(a: WhiteboardGeometry, b: WhiteboardGeometry): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation;
}

function objectState(value: WhiteboardObject): string {
  const json = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index++) { hash ^= json.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function snapshot(doc: Y.Doc): Snapshot {
  const objects = readObjects(doc);
  return { objects, byId: new Map(objects.map(value => [value.id, value])) };
}

/** Fabric projects canonical x/y as the rotation origin. Layout against those
 * scene bounds so rotated objects align visually without changing rotation. */
function sceneCorners(geometry: WhiteboardGeometry): { x: number; y: number }[] {
  const radians = geometry.rotation * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  return [[0, 0], [geometry.width, 0], [0, geometry.height], [geometry.width, geometry.height]].map(([x = 0, y = 0]) => ({
    x: geometry.x + x * cosine - y * sine,
    y: geometry.y + x * sine + y * cosine,
  }));
}

export function canonicalSceneBounds(geometry: WhiteboardGeometry): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  const points = sceneCorners(geometry);
  const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x)), bottom = Math.max(...points.map(point => point.y));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Resolve once in caller order. Selection may span containers, but arrange operations may not. */
export function resolveSelection(objects: readonly WhiteboardObject[], objectIds: readonly string[]): SelectionResolution {
  if (objectIds.length === 0 || new Set(objectIds).size !== objectIds.length) throw new Error('SELECTION_INVALID');
  const byId = new Map(objects.map(value => [value.id, value]));
  const selected = objectIds.map(id => {
    const value = byId.get(id);
    if (!value) throw new Error('OBJECT_NOT_FOUND');
    if (value.hidden) throw new Error('OBJECT_HIDDEN');
    if (value.locked) throw new Error('OBJECT_LOCKED');
    if (value.kind === 'connector') throw new Error('OBJECT_NOT_LAYOUTABLE');
    WhiteboardGeometrySchema.parse(value.geometry);
    return value;
  });
  const parentId = selected[0]?.parentId ?? null;
  const sameParent = selected.every(value => value.parentId === parentId);
  return { objectIds: [...objectIds], objects: selected, parentBoundary: sameParent ? 'same-parent' : 'mixed-parent', parentId: sameParent ? parentId : null };
}

function placementMap(selection: SelectionResolution, input: WhiteboardLayoutCommand): Map<string, WhiteboardGeometry> {
  const items = selection.objects;
  const result = new Map(items.map(item => [item.id, { ...item.geometry }]));
  const bounds = new Map(items.map(item => [item.id, canonicalSceneBounds(item.geometry)]));
  const left = Math.min(...items.map(item => bounds.get(item.id)!.left));
  const top = Math.min(...items.map(item => bounds.get(item.id)!.top));
  const right = Math.max(...items.map(item => bounds.get(item.id)!.right));
  const bottom = Math.max(...items.map(item => bounds.get(item.id)!.bottom));
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  const set = (item: WhiteboardObject, x: number, y: number) => result.set(item.id, { ...item.geometry, x: finite(x), y: finite(y) });

  if (input.kind.startsWith('align-')) {
    for (const item of items) {
      const visual = bounds.get(item.id)!;
      const dx = input.kind === 'align-left' ? left - visual.left : input.kind === 'align-center' ? centerX - (visual.left + visual.right) / 2 : input.kind === 'align-right' ? right - visual.right : 0;
      const dy = input.kind === 'align-top' ? top - visual.top : input.kind === 'align-middle' ? centerY - (visual.top + visual.bottom) / 2 : input.kind === 'align-bottom' ? bottom - visual.bottom : 0;
      set(item, item.geometry.x + dx, item.geometry.y + dy);
    }
    return result;
  }

  if (input.kind === 'distribute-horizontal' || input.kind === 'distribute-vertical') {
    if (items.length < 3) throw new Error('DISTRIBUTION_REQUIRES_THREE');
    const horizontal = input.kind === 'distribute-horizontal';
    const ordered = [...items].sort((a, b) => horizontal
      ? bounds.get(a.id)!.left - bounds.get(b.id)!.left || a.id.localeCompare(b.id)
      : bounds.get(a.id)!.top - bounds.get(b.id)!.top || a.id.localeCompare(b.id));
    const first = ordered[0]!, last = ordered.at(-1)!;
    const span = horizontal
      ? bounds.get(last.id)!.right - bounds.get(first.id)!.left
      : bounds.get(last.id)!.bottom - bounds.get(first.id)!.top;
    const occupied = ordered.reduce((sum, item) => sum + (horizontal ? bounds.get(item.id)!.width : bounds.get(item.id)!.height), 0);
    const gap = (span - occupied) / (ordered.length - 1);
    let cursor = horizontal ? bounds.get(first.id)!.left : bounds.get(first.id)!.top;
    ordered.forEach((item, index) => {
      if (index === 0 || index === ordered.length - 1) return;
      const previous = ordered[index - 1]!;
      cursor += (horizontal ? bounds.get(previous.id)!.width : bounds.get(previous.id)!.height) + gap;
      const visual = bounds.get(item.id)!;
      set(item, horizontal ? item.geometry.x + cursor - visual.left : item.geometry.x, horizontal ? item.geometry.y : item.geometry.y + cursor - visual.top);
    });
    return result;
  }

  if (input.kind === 'equal-width' || input.kind === 'equal-height' || input.kind === 'equal-size') {
    const width = Math.max(...items.map(item => item.geometry.width));
    const height = Math.max(...items.map(item => item.geometry.height));
    for (const item of items) result.set(item.id, {
      ...item.geometry,
      width: input.kind === 'equal-height' ? item.geometry.width : width,
      height: input.kind === 'equal-width' ? item.geometry.height : height,
    });
    return result;
  }

  const gap = input.gap ?? DEFAULT_LAYOUT_GAP;
  const horizontalGap = input.horizontalGap ?? gap;
  const verticalGap = input.verticalGap ?? gap;
  if (input.kind === 'row') {
    let x = left;
    for (const item of items) {
      const visual = bounds.get(item.id)!;
      set(item, item.geometry.x + x - visual.left, item.geometry.y + top - visual.top);
      x += visual.width + horizontalGap;
    }
    return result;
  }
  if (input.kind === 'column') {
    let y = top;
    for (const item of items) {
      const visual = bounds.get(item.id)!;
      set(item, item.geometry.x + left - visual.left, item.geometry.y + y - visual.top);
      y += visual.height + verticalGap;
    }
    return result;
  }

  const ordered = input.kind === 'tidy-up'
    ? [...items].sort((a, b) => bounds.get(a.id)!.top - bounds.get(b.id)!.top || bounds.get(a.id)!.left - bounds.get(b.id)!.left || a.id.localeCompare(b.id))
    : items;
  const columns = input.columns ?? Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowCount = Math.ceil(ordered.length / columns);
  const rowHeights = Array.from({ length: rowCount }, () => 0);
  ordered.forEach((item, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column]!, bounds.get(item.id)!.width);
    rowHeights[row] = Math.max(rowHeights[row]!, bounds.get(item.id)!.height);
  });
  const xs = columnWidths.map((_, index) => left + columnWidths.slice(0, index).reduce((sum, value) => sum + value, 0) + horizontalGap * index);
  const ys = rowHeights.map((_, index) => top + rowHeights.slice(0, index).reduce((sum, value) => sum + value, 0) + verticalGap * index);
  ordered.forEach((item, index) => {
    const visual = bounds.get(item.id)!;
    set(item, item.geometry.x + xs[index % columns]! - visual.left, item.geometry.y + ys[Math.floor(index / columns)]! - visual.top);
  });
  return result;
}

function descendants(current: Snapshot, roots: readonly WhiteboardObject[]): WhiteboardObject[] {
  const selected = new Set(roots.map(value => value.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const value of current.objects) if (value.parentId && selected.has(value.parentId) && !selected.has(value.id)) { selected.add(value.id); changed = true; }
  }
  return current.objects.filter(value => selected.has(value.id));
}

function verifyNoNestedSelection(current: Snapshot, selection: SelectionResolution): void {
  const ids = new Set(selection.objectIds);
  for (const item of selection.objects) {
    let parent = item.parentId;
    while (parent) {
      if (ids.has(parent)) throw new Error('SELECTION_NESTED');
      parent = current.byId.get(parent)?.parentId ?? null;
    }
  }
}

function verifyPreconditions(current: Snapshot, expected: readonly LayoutPrecondition[]): void {
  if (new Set(expected.map(value => value.id)).size !== expected.length) throw new Error('LAYOUT_PRECONDITION_INVALID');
  for (const value of expected) {
    const item = current.byId.get(value.id);
    if (!item) throw new Error('LAYOUT_CONFLICT');
    if (!sameGeometry(item.geometry, value.geometry)
      || (value.parentId !== undefined && value.parentId !== item.parentId)
      || (value.locked !== undefined && value.locked !== Boolean(item.locked))
      || (value.hidden !== undefined && value.hidden !== Boolean(item.hidden))
      || value.state !== objectState(item)) throw new Error('LAYOUT_CONFLICT');
  }
}

function within(child: WhiteboardGeometry, parent: WhiteboardGeometry): boolean {
  const radians = -parent.rotation * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  return sceneCorners(child).every(point => {
    const dx = point.x - parent.x, dy = point.y - parent.y;
    const x = dx * cosine - dy * sine, y = dx * sine + dy * cosine;
    return x >= -1e-9 && y >= -1e-9 && x <= parent.width + 1e-9 && y <= parent.height + 1e-9;
  });
}

function build(current: Snapshot, input: WhiteboardLayoutCommand, allowNoChange = false) {
  const command = WhiteboardLayoutCommand.parse(input);
  const selection = resolveSelection(current.objects, command.objectIds);
  if (selection.parentBoundary === 'mixed-parent') throw new Error('SELECTION_PARENT_BOUNDARY');
  verifyNoNestedSelection(current, selection);
  const placements = placementMap(selection, command);
  const commands: { type: 'geometry'; id: string; geometry: WhiteboardGeometry }[] = [];
  for (const item of selection.objects) {
    const next = placements.get(item.id)!;
    const dx = next.x - item.geometry.x, dy = next.y - item.geometry.y;
    const moved = ['frame', 'group'].includes(item.kind) ? descendants(current, [item]) : [item];
    for (const descendant of moved) {
      if (descendant.locked) throw new Error('OBJECT_LOCKED');
      const geometry = descendant.id === item.id ? next : { ...descendant.geometry, x: descendant.geometry.x + dx, y: descendant.geometry.y + dy };
      if (!sameGeometry(descendant.geometry, geometry)) commands.push({ type: 'geometry', id: descendant.id, geometry });
    }
  }
  if (selection.parentId) {
    const parent = current.byId.get(selection.parentId);
    if (!parent) throw new Error('INVALID_PARENT');
    const projectedById = new Map(selection.objects.map(item => [item.id, placements.get(item.id)!]));
    for (const command of commands) {
      const object = current.byId.get(command.id);
      if (object && object.kind !== 'connector' && command.id !== parent.id) projectedById.set(command.id, command.geometry);
    }
    const projected = [...projectedById.values()];
    if (projected.some(value => !within(value, parent.geometry))) {
      const metadata = parent.kind === 'frame' ? readPanelMetadata(parent) : null;
      if (!metadata?.autoExpand || metadata.clipContent || parent.locked) throw new Error('PARENT_BOUNDS_EXCEEDED');
      const padding = metadata.padding;
      const radians = parent.geometry.rotation * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
      const local = projected.flatMap(sceneCorners).map(point => {
        const dx = point.x - parent.geometry.x, dy = point.y - parent.geometry.y;
        return { x: dx * cosine + dy * sine, y: -dx * sine + dy * cosine };
      });
      const localLeft = Math.min(0, ...local.map(value => value.x - padding));
      const localTop = Math.min(0, ...local.map(value => value.y - padding));
      const localRight = Math.max(parent.geometry.width, ...local.map(value => value.x + padding));
      const localBottom = Math.max(parent.geometry.height, ...local.map(value => value.y + padding));
      commands.push({ type: 'geometry', id: parent.id, geometry: {
        ...parent.geometry,
        x: parent.geometry.x + localLeft * cosine - localTop * sine,
        y: parent.geometry.y + localLeft * sine + localTop * cosine,
        width: localRight - localLeft,
        height: localBottom - localTop,
      } });
    }
  }
  if (!commands.length && !allowNoChange) throw new Error('NO_LAYOUT_CHANGE');
  if (commands.length > WHITEBOARD_LIMITS.batch) throw new Error('LAYOUT_LIMIT_EXCEEDED');
  const selectedAfter = selection.objects.map(item => ({ id: item.id, geometry: structuredClone(placements.get(item.id)!) }));
  return { commands, selection, selectedAfter };
}

function mutationIds(current: Snapshot, built: ReturnType<typeof build>): string[] {
  const ids = new Set(built.commands.map(command => command.id));
  for (const object of current.objects) {
    if (object.connector && (ids.has(object.connector.from) || ids.has(object.connector.to))) ids.add(object.id);
  }
  return [...ids];
}

export function createLayoutPreconditions(objects: readonly WhiteboardObject[], input: WhiteboardLayoutCommand): LayoutPrecondition[] {
  const current: Snapshot = { objects: [...objects], byId: new Map(objects.map(value => [value.id, value])) };
  const built = build(current, input, true);
  const ids = new Set([...built.selection.objectIds, ...mutationIds(current, built)]);
  if (built.selection.parentId) ids.add(built.selection.parentId);
  return current.objects.filter(value => ids.has(value.id)).map(value => ({
    id: value.id, geometry: structuredClone(value.geometry), parentId: value.parentId,
    locked: Boolean(value.locked), hidden: Boolean(value.hidden),
    state: objectState(value),
  }));
}

export function arrangeObjects(objects: readonly WhiteboardObject[], input: WhiteboardLayoutCommand): LayoutGeometryState[] {
  const current: Snapshot = { objects: [...objects], byId: new Map(objects.map(value => [value.id, value])) };
  return build(current, input, true).selectedAfter;
}

export class SelectionLayoutCommandPort {
  private readonly accepted: Map<string, Accepted>;
  private readonly commandPort: BoardCommandPort;
  private readonly previews = new Map<string, LayoutCommandEnvelope>();
  constructor(private readonly doc: Y.Doc) {
    this.commandPort = new BoardCommandPort(doc);
    this.accepted = acceptedByDocument.get(doc) ?? new Map();
    if (!acceptedByDocument.has(doc)) acceptedByDocument.set(doc, this.accepted);
  }
  dispatch(input: LayoutCommandEnvelope): LayoutCommandAccepted {
    const key = JSON.stringify([input?.boardId, input?.clientId, input?.gestureId]);
    const payload = JSON.stringify({ command: input?.command, preconditions: input?.preconditions, stateVector: [...(input?.stateVector ?? [])] });
    const prior = this.accepted.get(key);
    if (prior) {
      if (prior.payload !== payload) throw new Error('LAYOUT_COMMAND_INVALID');
      return structuredClone(prior.result);
    }
    const current = snapshot(this.doc);
    if (!input.preconditions?.length) throw new Error('LAYOUT_PRECONDITION_REQUIRED');
    if (!(input.stateVector instanceof Uint8Array) || !sameBytes(input.stateVector, Y.encodeStateVector(this.doc))) throw new Error('LAYOUT_CONFLICT');
    verifyPreconditions(current, input.preconditions);
    const built = build(current, input.command);
    const expected = new Set(input.preconditions.map(value => value.id));
    if (mutationIds(current, built).some(id => !expected.has(id))) throw new Error('LAYOUT_CONFLICT');
    const accepted = this.commandPort.dispatch({ boardId: input.boardId, clientId: input.clientId, gestureId: input.gestureId, commands: built.commands });
    const updated = snapshot(this.doc);
    const selected = new Set(built.selection.objectIds);
    const changed = current.objects.filter(value => {
      const next = updated.byId.get(value.id);
      return next && !sameGeometry(value.geometry, next.geometry);
    }).sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id))
      || built.selection.objectIds.indexOf(a.id) - built.selection.objectIds.indexOf(b.id)
      || a.id.localeCompare(b.id));
    const event: ObjectsArrangedEvent = {
      type: 'ObjectsArranged', operationId: accepted.operationId, layoutKind: input.command.kind,
      selectionObjectIds: [...built.selection.objectIds], objectIds: changed.map(value => value.id),
      before: changed.map(value => ({ id: value.id, geometry: structuredClone(value.geometry) })),
      after: changed.map(value => ({ id: value.id, geometry: structuredClone(updated.byId.get(value.id)!.geometry) })),
    };
    const result: LayoutCommandAccepted = { ...accepted, events: [event] };
    this.accepted.set(key, { payload, result: structuredClone(result) });
    return result;
  }

  preview(input: LayoutCommandEnvelope): LayoutPreview {
    const current = snapshot(this.doc);
    if (!input.preconditions?.length || !(input.stateVector instanceof Uint8Array)) throw new Error('LAYOUT_PRECONDITION_REQUIRED');
    if (!sameBytes(input.stateVector, Y.encodeStateVector(this.doc))) throw new Error('LAYOUT_CONFLICT');
    verifyPreconditions(current, input.preconditions);
    const built = build(current, input.command, true);
    const expected = new Set(input.preconditions.map(value => value.id));
    if (mutationIds(current, built).some(id => !expected.has(id))) throw new Error('LAYOUT_CONFLICT');
    const previewId = JSON.stringify([input.boardId, input.clientId, input.gestureId]);
    this.previews.set(previewId, { ...input, stateVector: new Uint8Array(input.stateVector), preconditions: structuredClone(input.preconditions) });
    return { previewId, layoutKind: input.command.kind, geometries: built.commands.map(command => ({ id: command.id, geometry: structuredClone(command.geometry) })) };
  }
  cancelPreview(previewId: string): boolean { return this.previews.delete(previewId); }
  applyPreview(previewId: string): LayoutCommandAccepted {
    const input = this.previews.get(previewId);
    if (!input) throw new Error('LAYOUT_PREVIEW_NOT_FOUND');
    this.previews.delete(previewId);
    return this.dispatch(input);
  }
}

type Anchor = { value: number; anchor: 'start' | 'center' | 'end' };
function anchors(geometry: WhiteboardGeometry, axis: 'x' | 'y'): Anchor[] {
  const bounds = canonicalSceneBounds(geometry);
  const start = axis === 'x' ? bounds.left : bounds.top;
  const size = axis === 'x' ? bounds.width : bounds.height;
  return [{ value: start, anchor: 'start' }, { value: start + size / 2, anchor: 'center' }, { value: start + size, anchor: 'end' }];
}

/** Pure guide model: no Fabric/Yjs dependency and deterministic tie-breaking. */
export function calculateSnapGuides(
  moving: WhiteboardGeometry,
  targets: readonly Pick<WhiteboardObject, 'id' | 'geometry' | 'hidden'>[],
  threshold = 5,
): SnapResult {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('SNAP_THRESHOLD_INVALID');
  WhiteboardGeometrySchema.parse(moving);
  for (const target of targets) WhiteboardGeometrySchema.parse(target.geometry);
  const visible = targets.filter(value => !value.hidden).sort((a, b) => a.id.localeCompare(b.id));
  const guides: SnapGuide[] = [];
  const delta = { x: 0, y: 0 };
  for (const axis of ['x', 'y'] as const) {
    let winner: { distance: number; signed: number; guide: SnapGuide } | null = null;
    for (const source of anchors(moving, axis)) for (const target of visible) for (const candidate of anchors(target.geometry, axis)) {
      const signed = candidate.value - source.value, distance = Math.abs(signed);
      const guide: SnapGuide = { axis, position: candidate.value, movingAnchor: source.anchor, targetAnchor: candidate.anchor, targetId: target.id };
      if (distance <= threshold && (!winner || distance < winner.distance
        || (distance === winner.distance && JSON.stringify(guide) < JSON.stringify(winner.guide)))) winner = { distance, signed, guide };
    }
    const movingBounds = canonicalSceneBounds(moving);
    const start = axis === 'x' ? movingBounds.left : movingBounds.top;
    const size = axis === 'x' ? movingBounds.width : movingBounds.height;
    const before = visible.filter(value => {
      const bounds = canonicalSceneBounds(value.geometry);
      const end = axis === 'x' ? bounds.right : bounds.bottom;
      return end <= start;
    }).sort((a, b) => {
      const aBounds = canonicalSceneBounds(a.geometry), bBounds = canonicalSceneBounds(b.geometry);
      const aEnd = axis === 'x' ? aBounds.right : aBounds.bottom;
      const bEnd = axis === 'x' ? bBounds.right : bBounds.bottom;
      return bEnd - aEnd || a.id.localeCompare(b.id);
    })[0];
    const after = visible.filter(value => {
      const bounds = canonicalSceneBounds(value.geometry);
      return (axis === 'x' ? bounds.left : bounds.top) >= start + size;
    }).sort((a, b) => {
      const aBounds = canonicalSceneBounds(a.geometry), bBounds = canonicalSceneBounds(b.geometry);
      return (axis === 'x' ? aBounds.left - bBounds.left : aBounds.top - bBounds.top) || a.id.localeCompare(b.id);
    })[0];
    if (before && after) {
      const beforeBounds = canonicalSceneBounds(before.geometry), afterBounds = canonicalSceneBounds(after.geometry);
      const beforeEnd = axis === 'x' ? beforeBounds.right : beforeBounds.bottom;
      const afterStart = axis === 'x' ? afterBounds.left : afterBounds.top;
      const signed = (beforeEnd + afterStart - size) / 2 - start;
      if (Math.abs(signed) <= threshold && (!winner || Math.abs(signed) < winner.distance)) {
        winner = null;
        delta[axis] = signed;
      }
    }
    if (winner && delta[axis] === 0) { delta[axis] = winner.signed; guides.push(winner.guide); }
  }
  const geometry = { ...moving, x: moving.x + delta.x, y: moving.y + delta.y };
  const measurements: SnapMeasurement[] = [];
  const geometryBounds = canonicalSceneBounds(geometry);
  const left = visible.filter(value => canonicalSceneBounds(value.geometry).right <= geometryBounds.left)
    .sort((a, b) => canonicalSceneBounds(b.geometry).right - canonicalSceneBounds(a.geometry).right)[0];
  const right = visible.filter(value => canonicalSceneBounds(value.geometry).left >= geometryBounds.right)
    .sort((a, b) => canonicalSceneBounds(a.geometry).left - canonicalSceneBounds(b.geometry).left)[0];
  if (left && right) {
    const leftBounds = canonicalSceneBounds(left.geometry), rightBounds = canonicalSceneBounds(right.geometry);
    const a = geometryBounds.left - leftBounds.right, b = rightBounds.left - geometryBounds.right;
    if (Math.abs(a - b) <= threshold) {
      measurements.push(
        { axis: 'x', size: a, from: leftBounds.right, to: geometryBounds.left, relatedObjectIds: [left.id, right.id], equalSpacing: true },
        { axis: 'x', size: b, from: geometryBounds.right, to: rightBounds.left, relatedObjectIds: [left.id, right.id], equalSpacing: true },
      );
    }
  }
  const above = visible.filter(value => canonicalSceneBounds(value.geometry).bottom <= geometryBounds.top)
    .sort((a, b) => canonicalSceneBounds(b.geometry).bottom - canonicalSceneBounds(a.geometry).bottom)[0];
  const below = visible.filter(value => canonicalSceneBounds(value.geometry).top >= geometryBounds.bottom)
    .sort((a, b) => canonicalSceneBounds(a.geometry).top - canonicalSceneBounds(b.geometry).top)[0];
  if (above && below) {
    const aboveBounds = canonicalSceneBounds(above.geometry), belowBounds = canonicalSceneBounds(below.geometry);
    const a = geometryBounds.top - aboveBounds.bottom, b = belowBounds.top - geometryBounds.bottom;
    if (Math.abs(a - b) <= threshold) {
      measurements.push(
        { axis: 'y', size: a, from: aboveBounds.bottom, to: geometryBounds.top, relatedObjectIds: [above.id, below.id], equalSpacing: true },
        { axis: 'y', size: b, from: geometryBounds.bottom, to: belowBounds.top, relatedObjectIds: [above.id, below.id], equalSpacing: true },
      );
    }
  }
  return { geometry, delta, guides, measurements };
}
