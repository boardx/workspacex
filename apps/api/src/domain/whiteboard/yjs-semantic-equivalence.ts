import * as Y from 'yjs';
import { BoardBlobError } from './blob-errors';

function document(bytes: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, bytes); }
  catch { doc.destroy(); throw new BoardBlobError('INVALID_INPUT', 'invalid legacy Yjs content'); }
  return doc;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function deletionSet(bytes: Uint8Array): string {
  const decoded = Y.decodeUpdate(bytes);
  return JSON.stringify([...decoded.ds.clients.entries()].sort(([a], [b]) => a - b).map(([client, ranges]) =>
    [client, ranges.map(range => [range.clock, range.len])]),
  );
}

export function mergeLegacyYjsContent(snapshot: Uint8Array, updates: readonly Uint8Array[]): Uint8Array {
  const doc = document(snapshot);
  try {
    for (const update of updates) Y.applyUpdate(doc, update);
    return Y.encodeStateAsUpdate(doc);
  } catch { throw new BoardBlobError('INVALID_INPUT', 'invalid legacy Yjs update'); }
  finally { doc.destroy(); }
}

/** Byte ordering may differ; only empty state-vector diffs in both directions prove equality. */
export function yjsSemanticallyEqual(left: Uint8Array, right: Uint8Array): boolean {
  const a = document(left), b = document(right);
  try {
    const fullA = Y.encodeStateAsUpdate(a), fullB = Y.encodeStateAsUpdate(b);
    const aToB = Y.decodeUpdate(Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    const bToA = Y.decodeUpdate(Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    // Yjs state vectors do not carry deletion sets, so an otherwise empty diff
    // legitimately repeats already-known tombstones. Require zero missing structs
    // in both directions, equal vectors, equal tombstone ranges, and equal canonical
    // convergence under both merge orders. The final comparison is between
    // independently converged documents, not the two input serializations.
    const mergeAB = new Y.Doc(), mergeBA = new Y.Doc();
    Y.applyUpdate(mergeAB, fullA); Y.applyUpdate(mergeAB, fullB);
    Y.applyUpdate(mergeBA, fullB); Y.applyUpdate(mergeBA, fullA);
    const converged = bytesEqual(Y.encodeStateAsUpdate(mergeAB), Y.encodeStateAsUpdate(mergeBA));
    mergeAB.destroy(); mergeBA.destroy();
    return aToB.structs.length === 0 && bToA.structs.length === 0
      && bytesEqual(Y.encodeStateVector(a), Y.encodeStateVector(b))
      && deletionSet(fullA) === deletionSet(fullB)
      && converged;
  } finally { a.destroy(); b.destroy(); }
}
