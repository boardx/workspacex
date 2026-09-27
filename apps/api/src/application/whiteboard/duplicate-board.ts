import { createHash } from 'node:crypto';
import { whiteboard as C } from '@repo/contracts';
import { duplicateWhiteboardSnapshot } from '@repo/whiteboard-core';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { WhiteboardResourceError, type DuplicateBoard as DuplicateBoardInput, type DuplicateBoardService } from './ports';
import type { BoardContentCopyPort } from './board-content-copy-port';

type ObjectIdFactory = (requestId: string, sourceObjectId: string) => string;
const deterministicObjectId: ObjectIdFactory = (requestId, sourceObjectId) =>
  `copy_${createHash('sha256').update(requestId).update('\0').update(sourceObjectId).digest('hex')}`;

export class DuplicateBoard implements DuplicateBoardService {
  constructor(private readonly content: BoardContentCopyPort, private readonly objectId: ObjectIdFactory = deterministicObjectId) {}

  async duplicate(principal: Principal, sourceBoardId: string, raw: DuplicateBoardInput): Promise<C.DuplicateBoardResult> {
    assertPrincipal(principal);
    const boardId = C.BoardId.parse(sourceBoardId), input = C.DuplicateBoard.parse(raw);
    return this.content.duplicate(principal, boardId, input, captured => {
      if (input.expectedSource && (input.expectedSource.epoch !== captured.source.epoch || input.expectedSource.seq !== captured.source.seq)) {
        throw new WhiteboardResourceError('SOURCE_VERSION_CHANGED');
      }
      try {
        return duplicateWhiteboardSnapshot(captured.snapshot, sourceObjectId => this.objectId(input.requestId, sourceObjectId));
      } catch (error) {
        if (error instanceof WhiteboardResourceError) throw error;
        throw new WhiteboardResourceError('COPY_INTEGRITY_FAILED');
      }
    });
  }
}
