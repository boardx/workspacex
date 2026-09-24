import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WHITEBOARD_LIMITS } from '../src/whiteboard-document';
import {
  PublicWhiteboardCommandResult,
  PublicWhiteboardCommands,
  PublicWhiteboardDocument,
  operations,
} from '../src/whiteboard-public';

const boardId = randomUUID();
const requestId = randomUUID();

describe('public whiteboard contract', () => {
  it('shares bounded command limits and rejects caller identity or transport fields', () => {
    const command = { type: 'delete' as const, id: 'note' };

    expect(PublicWhiteboardCommands.parse({ epoch: 1, requestId, commands: [command] }))
      .toEqual({ epoch: 1, requestId, commands: [command] });
    expect(() => PublicWhiteboardCommands.parse({
      epoch: 1,
      requestId,
      commands: Array.from({ length: WHITEBOARD_LIMITS.batch + 1 }, () => command),
    })).toThrow();
    expect(() => PublicWhiteboardCommands.parse({
      epoch: 1,
      requestId,
      commands: [command],
      actorId: 'forged-owner',
    })).toThrow();
  });

  it('requires a committed durable receipt and exposes no raw update', () => {
    const receipt = { boardId, epoch: 1, seq: 2, requestId, replayed: false, durable: true as const };

    expect(PublicWhiteboardCommandResult.parse(receipt)).toEqual(receipt);
    expect(() => PublicWhiteboardCommandResult.parse({ ...receipt, durable: false })).toThrow();
    expect(() => PublicWhiteboardCommandResult.parse({ ...receipt, update: 'secret' })).toThrow();
  });

  it('keeps authenticated document projection and operation paths explicit', () => {
    expect(PublicWhiteboardDocument.parse({
      boardId,
      epoch: 1,
      seq: 0,
      role: 'viewer',
      archived: false,
      objects: [],
    })).toMatchObject({ boardId, role: 'viewer' });
    expect(operations.readDocument).toMatchObject({ method: 'GET', path: '/whiteboards/:boardId/document' });
    expect(operations.writeCommands).toMatchObject({ method: 'POST', path: '/whiteboards/:boardId/commands' });
  });
});
