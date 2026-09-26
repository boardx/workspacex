import { parentPort, workerData } from 'node:worker_threads';
import * as Y from 'yjs';
import { createWhiteboardDocument, executeCommands, prepareWhiteboardUpdate, validateDocument, readObjects, WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import type { WhiteboardCommand } from '@repo/contracts/whiteboard-document';

type Input = { mode: 'objects'; snapshot: Uint8Array } | { mode: 'object-ids'; snapshot: Uint8Array } | { mode: 'update'; snapshot: Uint8Array; update: Uint8Array } | { mode: 'commands'; snapshot: Uint8Array; commands: WhiteboardCommand[] } | { mode: 'diff'; snapshot: Uint8Array; vector?: Uint8Array };
const input = workerData as Input;
const doc = createWhiteboardDocument();
try {
  Y.applyUpdate(doc, input.snapshot);
  validateDocument(doc);
  if (input.mode === 'objects') {
    parentPort?.postMessage({ result: readObjects(doc) });
  } else if (input.mode === 'object-ids') {
    parentPort?.postMessage({ result: readObjects(doc).map(object => object.id) });
  } else if (input.mode === 'diff') {
    parentPort?.postMessage({ result: Y.encodeStateAsUpdate(doc, input.vector) });
  } else {
    let update: Uint8Array;
    if (input.mode === 'update') { update = prepareWhiteboardUpdate(doc, input.update); Y.applyUpdate(doc, update); }
    else {
      const vector = Y.encodeStateVector(doc);
      executeCommands(doc, input.commands, 'authorized-host-command');
      update = Y.encodeStateAsUpdate(doc, vector);
    }
    const snapshot = Y.encodeStateAsUpdate(doc);
    if (snapshot.byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes || [...doc.store.clients.values()].reduce((n, values) => n + values.length, 0) > WHITEBOARD_UPDATE_LIMITS.documentStructs) throw new Error('LIMIT');
    parentPort?.postMessage({ result: { snapshot, update } });
  }
} catch { parentPort?.postMessage({ rejected: true }); }
finally { doc.destroy(); }
