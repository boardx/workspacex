import {
  WHITEBOARD_LIMITS,
  WhiteboardGeometry,
  WhiteboardStyle,
  type WhiteboardCommand,
  type WhiteboardObject,
} from '@repo/contracts/whiteboard-document';
import { isWhiteboardObjectLocked } from './document';

export type ArrangeOperation =
  | 'align-left' | 'align-center' | 'align-right'
  | 'align-top' | 'align-middle' | 'align-bottom'
  | 'distribute-horizontal' | 'distribute-vertical';

export type BulkFormat = Partial<{
  width: number;
  height: number;
  fill: string;
  textAlign: 'left' | 'center' | 'right';
  fontSize: number;
}>;

export type BulkBuildErrorCode =
  | 'SELECTION_SIZE'
  | 'OBJECT_NOT_FOUND'
  | 'LOCKED_OBJECT'
  | 'UNSUPPORTED_OBJECT'
  | 'CONTAINER_SELECTION'
  | 'INVALID_FORMAT'
  | 'BATCH_LIMIT';

export type BulkBuildResult =
  | { ok: true; commands: WhiteboardCommand[]; affectedIds: string[] }
  | { ok: false; code: BulkBuildErrorCode; detail: string };

type Bounds = { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number; width: number; height: number };

const movableKinds = new Set<WhiteboardObject['kind']>(['sticky', 'text', 'rectangle', 'ellipse', 'frame', 'group', 'image', 'drawing', 'extension']);
const fillKinds = new Set<WhiteboardObject['kind']>(['sticky', 'rectangle', 'ellipse', 'frame', 'group']);
const textKinds = new Set<WhiteboardObject['kind']>(['sticky', 'text', 'rectangle', 'ellipse', 'frame', 'group']);

function visualBounds(object: WhiteboardObject): Bounds {
  const { x, y, width, height, rotation } = object.geometry;
  const radians = rotation * Math.PI / 180;
  const halfWidth = Math.abs(Math.cos(radians)) * width / 2 + Math.abs(Math.sin(radians)) * height / 2;
  const halfHeight = Math.abs(Math.sin(radians)) * width / 2 + Math.abs(Math.cos(radians)) * height / 2;
  const centerX = x + width / 2, centerY = y + height / 2;
  return { left: centerX - halfWidth, top: centerY - halfHeight, right: centerX + halfWidth, bottom: centerY + halfHeight, centerX, centerY, width: halfWidth * 2, height: halfHeight * 2 };
}

function selectedObjects(objects: WhiteboardObject[], selectedIds: string[], minimum: number): BulkBuildResult | WhiteboardObject[] {
  const ids = [...new Set(selectedIds)];
  if (ids.length < minimum || ids.length > 500) return { ok: false, code: 'SELECTION_SIZE', detail: `Select ${minimum}–500 objects for this action.` };
  const byId = new Map(objects.map(object => [object.id, object]));
  const selected: WhiteboardObject[] = [];
  for (const id of ids) {
    const object = byId.get(id);
    if (!object) return { ok: false, code: 'OBJECT_NOT_FOUND', detail: `Selected object ${id} no longer exists.` };
    if (isWhiteboardObjectLocked(object)) return { ok: false, code: 'LOCKED_OBJECT', detail: `Object ${id} is locked.` };
    if (!movableKinds.has(object.kind)) return { ok: false, code: 'UNSUPPORTED_OBJECT', detail: `Object ${id} cannot be arranged or formatted.` };
    selected.push(object);
  }
  return selected;
}

function hasSelectedAncestor(object: WhiteboardObject, selected: Set<string>, byId: Map<string, WhiteboardObject>): boolean {
  let parentId = object.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (selected.has(parentId)) return true;
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
}

function descendants(rootId: string, objects: WhiteboardObject[]): WhiteboardObject[] {
  const byParent = new Map<string, WhiteboardObject[]>();
  for (const object of objects) if (object.parentId) byParent.set(object.parentId, [...(byParent.get(object.parentId) ?? []), object]);
  const result: WhiteboardObject[] = [], queue = [...(byParent.get(rootId) ?? [])];
  while (queue.length) {
    const object = queue.shift()!;
    result.push(object);
    queue.push(...(byParent.get(object.id) ?? []));
  }
  return result;
}

function geometryCommand(object: WhiteboardObject, dx: number, dy: number): WhiteboardCommand | null {
  if (!dx && !dy) return null;
  const geometry = WhiteboardGeometry.safeParse({ ...object.geometry, x: object.geometry.x + dx, y: object.geometry.y + dy });
  return geometry.success ? { type: 'geometry', id: object.id, geometry: geometry.data } : null;
}

export function buildArrangeCommands(objects: WhiteboardObject[], selectedIds: string[], operation: ArrangeOperation): BulkBuildResult {
  const minimum = operation.startsWith('distribute-') ? 3 : 2;
  const selection = selectedObjects(objects, selectedIds, minimum);
  if (!Array.isArray(selection)) return selection;
  const byId = new Map(objects.map(object => [object.id, object]));
  const selected = new Set(selection.map(object => object.id));
  const roots = selection.filter(object => !hasSelectedAncestor(object, selected, byId));
  if (roots.length < minimum) return { ok: false, code: 'CONTAINER_SELECTION', detail: `Select ${minimum} independent objects; a selected Frame already owns its selected descendants.` };

  const bounds = new Map(roots.map(object => [object.id, visualBounds(object)]));
  const deltas = new Map<string, { dx: number; dy: number }>();
  if (operation.startsWith('align-')) {
    const all = [...bounds.values()];
    const left = Math.min(...all.map(value => value.left)), right = Math.max(...all.map(value => value.right));
    const top = Math.min(...all.map(value => value.top)), bottom = Math.max(...all.map(value => value.bottom));
    for (const object of roots) {
      const box = bounds.get(object.id)!;
      const dx = operation === 'align-left' ? left - box.left : operation === 'align-center' ? (left + right) / 2 - box.centerX : operation === 'align-right' ? right - box.right : 0;
      const dy = operation === 'align-top' ? top - box.top : operation === 'align-middle' ? (top + bottom) / 2 - box.centerY : operation === 'align-bottom' ? bottom - box.bottom : 0;
      deltas.set(object.id, { dx, dy });
    }
  } else {
    const horizontal = operation === 'distribute-horizontal';
    const ordered = [...roots].sort((a, b) => {
      const first = bounds.get(a.id)!, second = bounds.get(b.id)!;
      const delta = (horizontal ? first.left - second.left : first.top - second.top);
      return delta || a.id.localeCompare(b.id);
    });
    const first = bounds.get(ordered[0]!.id)!, last = bounds.get(ordered.at(-1)!.id)!;
    const total = ordered.reduce((sum, object) => sum + (horizontal ? bounds.get(object.id)!.width : bounds.get(object.id)!.height), 0);
    const span = horizontal ? last.right - first.left : last.bottom - first.top;
    const gap = (span - total) / (ordered.length - 1);
    let cursor = horizontal ? first.left : first.top;
    for (const [index, object] of ordered.entries()) {
      const box = bounds.get(object.id)!;
      const delta = index === 0 || index === ordered.length - 1 ? 0 : cursor - (horizontal ? box.left : box.top);
      deltas.set(object.id, { dx: horizontal ? delta : 0, dy: horizontal ? 0 : delta });
      cursor += (horizontal ? box.width : box.height) + gap;
    }
  }

  const changes = new Map<string, { object: WhiteboardObject; dx: number; dy: number }>();
  for (const root of roots) {
    const delta = deltas.get(root.id)!;
    changes.set(root.id, { object: root, ...delta });
    if (['frame', 'group'].includes(root.kind)) for (const child of descendants(root.id, objects)) {
      if (isWhiteboardObjectLocked(child)) return { ok: false, code: 'LOCKED_OBJECT', detail: `Locked descendant ${child.id} prevents moving its container.` };
      if (child.kind === 'connector') continue;
      changes.set(child.id, { object: child, ...delta });
    }
  }
  const commands: WhiteboardCommand[] = [];
  for (const { object, dx, dy } of [...changes.values()].sort((a, b) => a.object.id.localeCompare(b.object.id))) {
    const command = geometryCommand(object, dx, dy);
    if (!command && (dx || dy)) return { ok: false, code: 'INVALID_FORMAT', detail: `Arranging ${object.id} would exceed Board geometry limits.` };
    if (command) commands.push(command);
  }
  if (!commands.length) return { ok: false, code: 'INVALID_FORMAT', detail: 'The selected objects are already arranged.' };
  if (commands.length > WHITEBOARD_LIMITS.batch) return { ok: false, code: 'BATCH_LIMIT', detail: `This container move affects more than ${WHITEBOARD_LIMITS.batch} objects.` };
  return { ok: true, commands, affectedIds: [...changes.keys()].sort() };
}

export function buildFormatCommands(objects: WhiteboardObject[], selectedIds: string[], format: BulkFormat): BulkBuildResult {
  const selection = selectedObjects(objects, selectedIds, 2);
  if (!Array.isArray(selection)) return selection;
  const entries = Object.entries(format).filter(([, value]) => value !== undefined);
  if (entries.length !== 1) return { ok: false, code: 'INVALID_FORMAT', detail: 'Apply exactly one shared format choice at a time.' };
  const [key, value] = entries[0]!;
  const commands: WhiteboardCommand[] = [];
  for (const object of [...selection].sort((a, b) => a.id.localeCompare(b.id))) {
    if ((key === 'fill' && !fillKinds.has(object.kind)) || ((key === 'textAlign' || key === 'fontSize') && !textKinds.has(object.kind))) {
      return { ok: false, code: 'UNSUPPORTED_OBJECT', detail: `${object.kind} object ${object.id} does not support ${key}.` };
    }
    if (key === 'width' || key === 'height') {
      const geometry = WhiteboardGeometry.safeParse({ ...object.geometry, [key]: value });
      if (!geometry.success) return { ok: false, code: 'INVALID_FORMAT', detail: `${key} is outside Board geometry limits.` };
      commands.push({ type: 'geometry', id: object.id, geometry: geometry.data });
    } else {
      const style = WhiteboardStyle.safeParse({ [key]: value });
      if (!style.success) return { ok: false, code: 'INVALID_FORMAT', detail: `${key} is outside Board style limits.` };
      commands.push({ type: 'style', id: object.id, style: style.data });
    }
  }
  return { ok: true, commands, affectedIds: selection.map(object => object.id).sort() };
}
