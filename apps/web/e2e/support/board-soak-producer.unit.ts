/** Unit counterproofs for the wire observer; these are NOT runtime soak evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {Page} from '@playwright/test';
import * as Y from 'yjs';
import {createWhiteboardDocument, executeCommands} from '@repo/whiteboard-core';
import {BoardSoakClient, canonicalHash} from './board-soak-producer';

function fixture(role: 'editor' | 'viewer') {
  const page = new EventEmitter(), socket = Object.assign(new EventEmitter(), {url: () => 'ws://localhost/whiteboards/board/sync'});
  const client = new BoardSoakClient(page as unknown as Page, {userId: `actor-${role}`, role, email: 'unit@example.test', password: 'not-used'}, 'board');
  page.emit('websocket', socket);
  const incoming = (body: unknown) => socket.emit('framereceived', {payload: JSON.stringify(body)});
  const outgoing = (body: unknown) => socket.emit('framesent', {payload: JSON.stringify(body)});
  return {client, socket, incoming, outgoing};
}
test('observes a real Yjs committed update and stores the exact per-revision hash', () => {
  const {client, incoming, socket} = fixture('viewer'), server = createWhiteboardDocument();
  incoming({type: 'sync', epoch: 1, seq: 0, role: 'viewer', update: Buffer.from(Y.encodeStateAsUpdate(server)).toString('base64')});
  let update: Uint8Array = new Uint8Array(); server.on('update', value => {update = value;});
  executeCommands(server, [{type: 'create', object: {id: 'note', schemaVersion: 1, kind: 'sticky', text: 'real bytes', geometry: {x: 0, y: 0, width: 180, height: 180, rotation: 0}, style: {}, parentId: null, orderKey: 'a'}}], 'unit');
  incoming({type: 'update', epoch: 1, seq: 1, update: Buffer.from(update).toString('base64')});
  assert.equal(client.serverHashes.get(1), canonicalHash(server));
  assert.equal(client.connected, true);
  socket.emit('close'); assert.equal(client.connected, false);
  assert.equal(client.events.at(-1)?.type, 'disconnect');
  client.destroy(); server.destroy();
});
test('rejects an ACK with no actual outbound operation', () => {
  const {client, incoming} = fixture('editor');
  incoming({type: 'ack', updateId: 'absent', seq: 1});
  assert.throws(() => client.assertHealthy(), /SOAK_TRANSPORT_FAILURE/);
  assert.equal(client.acknowledgements.length, 0); client.destroy();
});
test('records a real outbound timestamp and unique ACK without storing payloads or secrets', () => {
  const {client, incoming, outgoing} = fixture('editor'), doc = createWhiteboardDocument();
  const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  incoming({type: 'sync', epoch: 1, seq: 0, role: 'editor', update});
  outgoing({type: 'update', epoch: 1, updateId: 'observed-operation', update});
  incoming({type: 'ack', updateId: 'observed-operation', seq: 1});
  incoming({type: 'ack', updateId: 'observed-operation', seq: 1});
  assert.equal(client.acknowledgements.length, 1);
  const ack = client.acknowledgements[0]!;
  assert.ok(Date.parse(ack.acknowledgedAt) >= Date.parse(ack.sentAt));
  assert.ok(ack.acknowledgedMonotonicMs >= ack.sentMonotonicMs);
  assert.equal('update' in ack, false); client.assertHealthy(); client.destroy(); doc.destroy();
});
