import { createHash, randomUUID } from 'node:crypto';
import { whiteboardTransfer as C } from '@repo/contracts';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { WhiteboardTransferError as Fault } from './transfer-ports';

function encodedBytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value)); } catch { throw new Fault('VALIDATION_FAILED'); }
}
export function parsePortableImport(input: unknown): C.ImportBoardInput {
  if (encodedBytes(input) > C.PORTABLE_BOARD.maxBytes) throw new Fault('VALIDATION_FAILED');
  const parsed = C.ImportBoardInput.safeParse(input);
  if (!parsed.success) throw new Fault('VALIDATION_FAILED');
  validateReferences(parsed.data.package.objects);
  return structuredClone(parsed.data);
}
export function validateReferences(objects: readonly WhiteboardObject[]): void {
  const byId = new Map<string, WhiteboardObject>();
  for (const object of objects) {
    if (byId.has(object.id)) throw new Fault('VALIDATION_FAILED');
    byId.set(object.id, object);
  }
  for (const object of objects) {
    if (object.parentId) {
      const parent = byId.get(object.parentId);
      if (!parent || !['frame', 'group'].includes(parent.kind)) throw new Fault('VALIDATION_FAILED');
    }
    if (object.connector && (!byId.has(object.connector.from) || !byId.has(object.connector.to))) throw new Fault('VALIDATION_FAILED');
    const visited = new Set([object.id]); let parentId = object.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new Fault('VALIDATION_FAILED');
      visited.add(parentId); parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
}
function depth(object: WhiteboardObject, byId: Map<string, WhiteboardObject>): number {
  let value = 0, parent = object.parentId;
  while (parent) { value++; parent = byId.get(parent)?.parentId ?? null; }
  return value;
}
export function remapPortableObjects(objects: readonly WhiteboardObject[], idFactory: () => string = randomUUID): WhiteboardObject[] {
  validateReferences(objects);
  const ids = new Map(objects.map(object => [object.id, idFactory()]));
  if (new Set(ids.values()).size !== ids.size) throw new Fault('VALIDATION_FAILED');
  const byId = new Map(objects.map(object => [object.id, object]));
  const depths = new Map(objects.map(object => [ids.get(object.id)!, depth(object, byId)]));
  return objects.map(object => ({
    ...structuredClone(object), id: ids.get(object.id)!,
    parentId: object.parentId ? ids.get(object.parentId)! : null,
    ...(object.connector ? { connector: { from: ids.get(object.connector.from)!, to: ids.get(object.connector.to)! } } : {}),
  })).sort((a, b) => {
    const connector = Number(a.kind === 'connector') - Number(b.kind === 'connector');
    return connector || depths.get(a.id)! - depths.get(b.id)!;
  });
}
export function importPreview(input: C.ImportBoardInput): C.ImportBoardPreview {
  const objects = input.package.objects;
  validateReferences(objects);
  const destinationName = input.name ?? `${input.package.source.name.slice(0, 194)}（导入）`;
  return C.ImportBoardPreview.parse({
    sourceName: input.package.source.name,
    destinationName,
    objectCount: objects.length,
    frameCount: objects.filter(o => o.kind === 'frame').length,
    groupCount: objects.filter(o => o.kind === 'group').length,
    connectorCount: objects.filter(o => o.kind === 'connector').length,
    identitiesRemapped: objects.length,
    contentLosses: [],
  });
}
export function canonicalImportHash(input: C.ImportBoardInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
export function batchRequestId(requestId: string, index: number): string {
  const hex = createHash('sha256').update(`${requestId}:${index}`).digest('hex').slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
}
