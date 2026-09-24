import { createHash } from 'node:crypto';
import { extractMermaidBlocks } from '@repo/fabric-markdown/markdown';
import type { whiteboardImport as C } from '@repo/contracts';
import { prepareDiagramImport } from '@repo/whiteboard-core';
import type { Principal } from '../../domain/principal';
import type { DecisionIdFactory, IdentityRepository } from '../identity/ports';
import { discloseDecided, isDisclosed } from '../security/permission-filter';
import type { ChatRepository } from '../chat/ports';
import { resolveVisibility } from '../chat/resolve-visibility';
import type { WhiteboardCollaborationStore } from './collaboration-ports';
import type { WhiteboardRepository } from './ports';

export type ImportChatDiagramCode = 'NOT_FOUND' | 'FORBIDDEN' | 'ARCHIVED' | 'SOURCE_CHANGED' | 'LOSS_CONSENT_REQUIRED' | 'INVALID_DIAGRAM' | 'CAPACITY';
export class ImportChatDiagramError extends Error {
  constructor(readonly code: ImportChatDiagramCode, readonly losses: readonly C.DiagramImportLoss[] = []) { super(code); }
}
export interface ImportChatDiagramDeps {
  boards: WhiteboardRepository;
  collaboration: WhiteboardCollaborationStore;
  chat: ChatRepository;
  repo: IdentityRepository;
  ids: DecisionIdFactory;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const blockIdentity = (kind: string, code: string) => hash(`${kind}\0${code}`);

/** Target write access is checked before any chat body is read. The collaboration store repeats it under lock at commit. */
export async function importChatDiagram(
  deps: ImportChatDiagramDeps,
  principal: Principal,
  boardId: string,
  input: C.ImportDiagramInput,
): Promise<C.ImportDiagramResult> {
  const board = await deps.boards.get(principal, boardId);
  if (!board) throw new ImportChatDiagramError('NOT_FOUND');
  if (board.role === 'viewer') throw new ImportChatDiagramError('FORBIDDEN');
  if (board.archived) throw new ImportChatDiagramError('ARCHIVED');

  const location = await deps.chat.findMessageLocation(principal.orgId, input.sourceRef.messageId);
  if (!location || location.threadId !== input.sourceRef.threadId) throw new ImportChatDiagramError('NOT_FOUND');
  const visibility = await resolveVisibility({ chat: deps.chat, repo: deps.repo, ids: deps.ids }, {
    userId: principal.userId, orgId: principal.orgId, projectId: location.projectId, threadId: location.threadId,
  });
  if (visibility.kind !== 'allow') throw new ImportChatDiagramError('NOT_FOUND');
  const guarded = await deps.chat.findMessages(principal.orgId, location.threadId);
  if (!guarded) throw new ImportChatDiagramError('NOT_FOUND');
  const disclosed = discloseDecided(guarded, visibility.base);
  if (!isDisclosed(disclosed)) throw new ImportChatDiagramError('NOT_FOUND');
  const message = disclosed.payload.find(item => item.id === input.sourceRef.messageId);
  if (!message) throw new ImportChatDiagramError('NOT_FOUND');

  const matches = extractMermaidBlocks(message.body).filter(block =>
    block.closed && block.lang === input.sourceRef.kind && hash(block.code) === input.sourceRef.sourceHash &&
    blockIdentity(block.lang, block.code) === input.sourceRef.blockId,
  );
  if (matches.length !== 1 || input.sourceRef.sourceVersion !== `sha256:${input.sourceRef.sourceHash}`) {
    throw new ImportChatDiagramError('SOURCE_CHANGED');
  }

  const prepared = prepareDiagramImport(input.bundle, input.requestId.replaceAll('-', '_'), input.sourceRef);
  if (!prepared.ok) throw new ImportChatDiagramError(prepared.code === 'CAPACITY' ? 'CAPACITY' : 'INVALID_DIAGRAM', prepared.losses);
  const needed = new Set(prepared.losses.map(loss => loss.code));
  const accepted = new Set(input.acceptedLosses);
  if ([...needed].some(code => !accepted.has(code))) throw new ImportChatDiagramError('LOSS_CONSENT_REQUIRED', prepared.losses);
  const head = await deps.collaboration.head(principal, boardId);
  const ack = await deps.collaboration.writeCommands(principal, boardId, {
    epoch: head.epoch, requestId: input.requestId, commands: prepared.commands,
  });
  return { boardId, groupId: prepared.groupId, epoch: ack.epoch, seq: ack.seq, losses: prepared.losses };
}
