import * as Y from 'yjs';
import { WhiteboardConnector, type WhiteboardObject } from '@repo/contracts/whiteboard-document';

const sides = ['from', 'to'] as const;
const keys = (side: typeof sides[number]) => [side, `${side}Point`, `${side}Anchor`, `${side}Offset`] as const;
const slot = (side: typeof sides[number]) => `connector${side === 'from' ? 'From' : 'To'}`;
const pick = (value: Record<string, unknown>, names: readonly string[]) => Object.fromEntries(names.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));

/** A legacy connector is the immutable endpoint fallback; an existing slot is
 * the sole effective value for its endpoint. No nested shared types are allowed. */
export function decodeConnectorStorage(json: Record<string, unknown>): Record<string, unknown> {
  const result = { ...json };
  if (sides.some(side => Object.hasOwn(result, slot(side)))) {
    if (result.kind !== 'connector' || !result.connector || typeof result.connector !== 'object' || Array.isArray(result.connector)) throw new Error('INVALID_CONNECTOR_STORAGE');
    const connector = { ...result.connector as Record<string, unknown> };
    for (const side of sides) {
      const name = slot(side);
      if (!Object.hasOwn(result, name)) continue;
      const endpoint = result[name];
      if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint) || Object.keys(endpoint).some(key => !keys(side).includes(key as never))) throw new Error('INVALID_CONNECTOR_STORAGE');
      for (const key of keys(side)) delete connector[key];
      Object.assign(connector, endpoint);
    }
    result.connector = WhiteboardConnector.parse(connector);
  }
  for (const side of sides) delete result[slot(side)];
  return result;
}

/** Write only changed endpoint groups; appearance edits keep fallback endpoints
 * untouched and never write a concurrent peer's endpoint slot. */
export function writeConnectorStorage(item: Y.Map<unknown>, current: NonNullable<WhiteboardObject['connector']>, next: NonNullable<WhiteboardObject['connector']>): void {
  const before = current as Record<string, unknown>, after = next as Record<string, unknown>;
  for (const side of sides) {
    const previous = pick(before, keys(side)), endpoint = pick(after, keys(side));
    if (JSON.stringify(previous) !== JSON.stringify(endpoint)) item.set(slot(side), structuredClone(endpoint));
  }
  const endpointKeys = sides.flatMap(keys);
  const appearance = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => !endpointKeys.includes(key as never)));
  if (JSON.stringify(appearance(before)) !== JSON.stringify(appearance(after))) {
    const fallback = item.get('connector') as Record<string, unknown>;
    item.set('connector', structuredClone({ ...appearance(after), ...pick(fallback, endpointKeys) }));
  }
}

/** Reject old clients replacing a fallback after slots exist: that write would
 * otherwise be accepted but silently ignored by the effective endpoint. */
export function assertConnectorFallbackUnchanged(before: Y.Map<unknown>, after: Y.Map<unknown>): void {
  const previous = before.get('connector') as Record<string, unknown> | undefined;
  const next = after.get('connector') as Record<string, unknown> | undefined;
  for (const side of sides) {
    if (!before.has(slot(side)) && !after.has(slot(side))) continue;
    if (JSON.stringify(pick(previous ?? {}, keys(side))) !== JSON.stringify(pick(next ?? {}, keys(side)))) throw new Error('CONNECTOR_LEGACY_ENDPOINT_WRITE');
  }
}
