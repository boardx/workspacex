import type * as Y from 'yjs';
import {
  WhiteboardGeometry as WhiteboardGeometrySchema,
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
  preconditions?: LayoutPrecondition[];
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

function snapshot(doc: Y.Doc): Snapshot {
  const objects = readObjects(doc);
  return { objects, byId: new Map(objects.map(value => [value.id, value])) };
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
  const left = Math.min(...items.map(item => item.geometry.x));
  const top = Math.min(...items.map(item => item.geometry.y));
  const right = Math.max(...items.map(item => item.geometry.x + item.geometry.width));
  const bottom = Math.max(...items.map(item => item.geometry.y + item.geometry.height));
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  const set = (item: WhiteboardObject, x: number, y: number) => result.set(item.id, { ...item.geometry, x: finite(x), y: finite(y) });

  if (input.kind.startsWith('align-')) {
    for (const item of items) {
      const x = input.kind === 'align-left' ? left : input.kind === 'align-center' ? centerX - item.geometry.width / 2 : input.kind === 'align-right' ? right - item.geometry.width : item.geometry.x;
      const y = input.kind === 'align-top' ? top : input.kind === 'align-middle' ? centerY - item.geometry.height / 2 : input.kind === 'align-bottom' ? bottom - item.geometry.height : item.geometry.y;
      set(item, x, y);
    }
    return result;
  }

  if (input.kind === 'distribute-horizontal' || input.kind === 'distribute-vertical') {
    if (items.length < 3) throw new Error('DISTRIBUTION_REQUIRES_THREE');
    const horizontal = input.kind === 'distribute-horizontal';
    const ordered = [...items].sort((a, b) => horizontal
      ? a.geometry.x - b.geometry.x || a.id.localeCompare(b.id)
      : a.geometry.y - b.geometry.y || a.id.localeCompare(b.id));
    const first = ordered[0]!, last = ordered.at(-1)!;
    const span = horizontal
      ? last.geometry.x + last.geometry.width - first.geometry.x
      : last.geometry.y + last.geometry.height - first.geometry.y;
    const occupied = ordered.reduce((sum, item) => sum + (horizontal ? item.geometry.width : item.geometry.height), 0);
    const gap = (span - occupied) / (ordered.length - 1);
    let cursor = horizontal ? first.geometry.x : first.geometry.y;
    ordered.forEach((item, index) => {
      if (index === 0 || index === ordered.length - 1) return;
      const previous = ordered[index - 1]!;
      cursor += (horizontal ? previous.geometry.width : previous.geometry.height) + gap;
      set(item, horizontal ? cursor : item.geometry.x, horizontal ? item.geometry.y : cursor);
    });
    return result;
  }

  const gap = input.gap ?? DEFAULT_LAYOUT_GAP;
  const horizontalGap = input.horizontalGap ?? gap;
  const verticalGap = input.verticalGap ?? gap;
  if (input.kind === 'row') {
    let x = left;
    for (const item of items) { set(item, x, top); x += item.geometry.width + horizontalGap; }
    return result;
  }
  if (input.kind === 'column') {
    let y = top;
    for (const item of items) { set(item, left, y); y += item.geometry.height + verticalGap; }
    return result;
  }

  const ordered = input.kind === 'tidy-up'
    ? [...items].sort((a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x || a.id.localeCompare(b.id))
    : items;
  const columns = input.columns ?? Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowCount = Math.ceil(ordered.length / columns);
  const rowHeights = Array.from({ length: rowCount }, () => 0);
  ordered.forEach((item, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column]!, item.geometry.width);
    rowHeights[row] = Math.max(rowHeights[row]!, item.geometry.height);
  });
  const xs = columnWidths.map((_, index) => left + columnWidths.slice(0, index).reduce((sum, value) => sum + value, 0) + horizontalGap * index);
  const ys = rowHeights.map((_, index) => top + rowHeights.slice(0, index).reduce((sum, value) => sum + value, 0) + verticalGap * index);
  ordered.forEach((item, index) => set(item, xs[index % columns]!, ys[Math.floor(index / columns)]!));
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
      || (value.hidden !== undefined && value.hidden !== Boolean(item.hidden))) throw new Error('LAYOUT_CONFLICT');
  }
}

function within(child: WhiteboardGeometry, parent: WhiteboardGeometry): boolean {
  return child.x >= parent.x && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
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
    const projected = selection.objects.map(item => placements.get(item.id)!);
    if (projected.some(value => !within(value, parent.geometry))) {
      const metadata = parent.kind === 'frame' ? readPanelMetadata(parent) : null;
      if (!metadata?.autoExpand || metadata.clipContent || parent.locked) throw new Error('PARENT_BOUNDS_EXCEEDED');
      const padding = metadata.padding;
      const left = Math.min(parent.geometry.x, ...projected.map(value => value.x - padding));
      const top = Math.min(parent.geometry.y, ...projected.map(value => value.y - padding));
      const right = Math.max(parent.geometry.x + parent.geometry.width, ...projected.map(value => value.x + value.width + padding));
      const bottom = Math.max(parent.geometry.y + parent.geometry.height, ...projected.map(value => value.y + value.height + padding));
      commands.push({ type: 'geometry', id: parent.id, geometry: { ...parent.geometry, x: left, y: top, width: right - left, height: bottom - top } });
    }
  }
  if (!commands.length && !allowNoChange) throw new Error('NO_LAYOUT_CHANGE');
  if (commands.length > 200) throw new Error('LAYOUT_LIMIT_EXCEEDED');
  const selectedAfter = selection.objects.map(item => ({ id: item.id, geometry: structuredClone(placements.get(item.id)!) }));
  return { commands, selection, selectedAfter };
}

export function arrangeObjects(objects: readonly WhiteboardObject[], input: WhiteboardLayoutCommand): LayoutGeometryState[] {
  const current: Snapshot = { objects: [...objects], byId: new Map(objects.map(value => [value.id, value])) };
  return build(current, input, true).selectedAfter;
}

export class SelectionLayoutCommandPort {
  private readonly accepted: Map<string, Accepted>;
  private readonly commandPort: BoardCommandPort;
  constructor(private readonly doc: Y.Doc) {
    this.commandPort = new BoardCommandPort(doc);
    this.accepted = acceptedByDocument.get(doc) ?? new Map();
    if (!acceptedByDocument.has(doc)) acceptedByDocument.set(doc, this.accepted);
  }
  dispatch(input: LayoutCommandEnvelope): LayoutCommandAccepted {
    const key = JSON.stringify([input?.boardId, input?.clientId, input?.gestureId]);
    const payload = JSON.stringify({ command: input?.command, preconditions: input?.preconditions ?? [] });
    const prior = this.accepted.get(key);
    if (prior) {
      if (prior.payload !== payload) throw new Error('LAYOUT_COMMAND_INVALID');
      return structuredClone(prior.result);
    }
    const current = snapshot(this.doc);
    verifyPreconditions(current, input.preconditions ?? []);
    const built = build(current, input.command);
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
}

type Anchor = { value: number; anchor: 'start' | 'center' | 'end' };
function anchors(geometry: WhiteboardGeometry, axis: 'x' | 'y'): Anchor[] {
  const start = axis === 'x' ? geometry.x : geometry.y;
  const size = axis === 'x' ? geometry.width : geometry.height;
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
    const start = axis === 'x' ? moving.x : moving.y;
    const size = axis === 'x' ? moving.width : moving.height;
    const before = visible.filter(value => {
      const end = axis === 'x' ? value.geometry.x + value.geometry.width : value.geometry.y + value.geometry.height;
      return end <= start;
    }).sort((a, b) => {
      const aEnd = axis === 'x' ? a.geometry.x + a.geometry.width : a.geometry.y + a.geometry.height;
      const bEnd = axis === 'x' ? b.geometry.x + b.geometry.width : b.geometry.y + b.geometry.height;
      return bEnd - aEnd || a.id.localeCompare(b.id);
    })[0];
    const after = visible.filter(value => (axis === 'x' ? value.geometry.x : value.geometry.y) >= start + size)
      .sort((a, b) => (axis === 'x' ? a.geometry.x - b.geometry.x : a.geometry.y - b.geometry.y) || a.id.localeCompare(b.id))[0];
    if (before && after) {
      const beforeEnd = axis === 'x' ? before.geometry.x + before.geometry.width : before.geometry.y + before.geometry.height;
      const afterStart = axis === 'x' ? after.geometry.x : after.geometry.y;
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
  const left = visible.filter(value => value.geometry.x + value.geometry.width <= geometry.x)
    .sort((a, b) => b.geometry.x + b.geometry.width - (a.geometry.x + a.geometry.width))[0];
  const right = visible.filter(value => value.geometry.x >= geometry.x + geometry.width).sort((a, b) => a.geometry.x - b.geometry.x)[0];
  if (left && right) {
    const a = geometry.x - (left.geometry.x + left.geometry.width), b = right.geometry.x - (geometry.x + geometry.width);
    if (Math.abs(a - b) <= threshold) {
      measurements.push(
        { axis: 'x', size: a, from: left.geometry.x + left.geometry.width, to: geometry.x, relatedObjectIds: [left.id, right.id], equalSpacing: true },
        { axis: 'x', size: b, from: geometry.x + geometry.width, to: right.geometry.x, relatedObjectIds: [left.id, right.id], equalSpacing: true },
      );
    }
  }
  const above = visible.filter(value => value.geometry.y + value.geometry.height <= geometry.y)
    .sort((a, b) => b.geometry.y + b.geometry.height - (a.geometry.y + a.geometry.height))[0];
  const below = visible.filter(value => value.geometry.y >= geometry.y + geometry.height).sort((a, b) => a.geometry.y - b.geometry.y)[0];
  if (above && below) {
    const a = geometry.y - (above.geometry.y + above.geometry.height), b = below.geometry.y - (geometry.y + geometry.height);
    if (Math.abs(a - b) <= threshold) {
      measurements.push(
        { axis: 'y', size: a, from: above.geometry.y + above.geometry.height, to: geometry.y, relatedObjectIds: [above.id, below.id], equalSpacing: true },
        { axis: 'y', size: b, from: geometry.y + geometry.height, to: below.geometry.y, relatedObjectIds: [above.id, below.id], equalSpacing: true },
      );
    }
  }
  return { geometry, delta, guides, measurements };
}
