import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { whiteboard as C } from '@repo/contracts';
import { createWhiteboardDocument, readContentObject, readObjects } from '@repo/whiteboard-core';
import * as Y from 'yjs';
import { WHITEBOARD_REPOSITORY, type WhiteboardRepository } from '../../application/whiteboard/ports';
import { WHITEBOARD_COLLABORATION_STORE, type WhiteboardCollaborationStore } from '../../application/whiteboard/collaboration-ports';
import { WHITEBOARD_IMAGE_ASSETS, WhiteboardImageError, type WhiteboardImageAssets } from '../../application/whiteboard/image-assets';
import { toOrgId } from '../../domain/org-id';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { Public } from '../public.decorator';

const developmentKey = randomBytes(32);
const noStore = 'private, no-store';
function sign(body: string) {
  const key = process.env.MODEL_CREDENTIAL_KEY;
  if (!key && process.env.NODE_ENV === 'production') throw new Error('Board share signing key unavailable');
  return createHmac('sha256', key || developmentKey).update(`whiteboard-public-view:v1:${body}`).digest('base64url');
}

type ShareClaim = { boardId: string; orgId: string; userId: string; expires: number };

function readClaim(token: string): ShareClaim {
  if (token.length > 1024) throw new NotFoundException();
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) throw new NotFoundException();
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException();
  const claim = JSON.parse(Buffer.from(body, 'base64url').toString()) as ShareClaim;
  if (!Number.isSafeInteger(claim.expires) || claim.expires <= Date.now()) throw new NotFoundException();
  return claim;
}

@Controller()
export class WhiteboardShareController {
  constructor(
    @Inject(WHITEBOARD_REPOSITORY) private readonly boards: WhiteboardRepository,
    @Inject(WHITEBOARD_COLLABORATION_STORE) private readonly collaboration: WhiteboardCollaborationStore,
    @Inject(WHITEBOARD_IMAGE_ASSETS) private readonly images: WhiteboardImageAssets,
  ) {}

  @Post(C.sharePaths.create)
  @Header('Cache-Control', noStore)
  async create(@CurrentPrincipal() principal: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string) {
    assertPrincipal(principal);
    await this.requireOwner(principal, boardId);
    const expires = Date.now() + C.BOARD_SHARE_TTL_MS;
    const claim: ShareClaim = { boardId, orgId: principal.orgId, userId: principal.userId, expires };
    const body = Buffer.from(JSON.stringify(claim)).toString('base64url');
    return C.CreatedBoardShare.parse({ token: `${body}.${sign(body)}`, expiresAt: new Date(expires).toISOString() });
  }

  @Public()
  @Get(C.sharePaths.read)
  @Header('Cache-Control', noStore)
  async read(@Param('token') token: string) {
    const { board, objects, claim } = await this.resolve(token);
    return C.PublicBoardShare.parse({
      title: board.name,
      expiresAt: new Date(claim.expires).toISOString(),
      objects: objects.map(({ extensionData, restoredFrom: _restoredFrom, ...object }) => ({
        ...object,
        extensionData: extensionData && Object.fromEntries(
          ['contentObject', 'thinkingInput', 'spatial'].filter(key => extensionData[key] !== undefined).map(key => [key, extensionData[key]]),
        ),
      })),
    });
  }

  @Public()
  @Get(C.sharePaths.image)
  @Header('Cache-Control', noStore)
  async image(@Param('token') token: string, @Param('assetId') assetId: string, @Res() response: Response) {
    const { principal, claim, objects } = await this.resolve(token);
    if (!objects.some(object => {
      const content = readContentObject(object);
      return content?.type === 'image' && content.persistence !== 'local-session' && content.assetId === assetId;
    })) throw new NotFoundException();
    try {
      const result = await this.images.read(principal, claim.boardId, assetId);
      readClaim(token);
      response.setHeader('Cache-Control', noStore);
      response.setHeader('Content-Type', result.metadata.mimeType);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      response.send(Buffer.from(result.bytes));
    } catch (error) {
      if (error instanceof WhiteboardImageError && ['FORBIDDEN', 'NOT_FOUND'].includes(error.code)) throw new NotFoundException();
      throw error;
    }
  }

  private async requireOwner(principal: Principal, boardId: string) {
    const board = await this.boards.get(principal, boardId);
    if (!board || board.role !== 'owner' || board.archived) throw new NotFoundException();
    return board;
  }

  private async resolve(token: string) {
    const claim = readClaim(token);
    const principal = { userId: claim.userId, orgId: toOrgId(claim.orgId) };
    const board = await this.requireOwner(principal, claim.boardId);
    const snapshot = await this.collaboration.load(principal, claim.boardId);
    if (snapshot.role !== 'owner' || snapshot.archived) throw new NotFoundException();
    readClaim(token);
    const doc = createWhiteboardDocument();
    try {
      Y.applyUpdate(doc, snapshot.update);
      const objects = readObjects(doc);
      const hidden = new Set(objects.filter(object => object.hidden).map(object => object.id));
      const byId = new Map(objects.map(object => [object.id, object]));
      function visible(id: string, visited = new Set<string>()): boolean {
        if (hidden.has(id) || visited.has(id)) return false;
        visited.add(id);
        const parent = byId.get(id)?.parentId;
        return !parent || visible(parent, visited);
      }
      return { board, claim, principal, objects: objects.filter(object => visible(object.id)) };
    } finally {
      doc.destroy();
    }
  }
}
