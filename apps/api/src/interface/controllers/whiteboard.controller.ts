import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, StreamableFile } from '@nestjs/common';
import { whiteboard as C, whiteboardHistory as H } from '@repo/contracts';
import { whiteboardTransfer as T } from '@repo/contracts';
import { WHITEBOARD_REPOSITORY, type WhiteboardRepository, type CreateBoard, type UpdateBoard, type Member } from '../../application/whiteboard/ports';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';
import { WHITEBOARD_TRANSFER_STORE, WhiteboardTransferError, type WhiteboardTransferStore } from '../../application/whiteboard/transfer-ports';
import { WHITEBOARD_HISTORY_STORE, type WhiteboardHistoryStore, type CreateCheckpointInput, type CompareCheckpointInput, type RestoreCheckpointInput } from '../../application/whiteboard/history-ports';
import { WhiteboardCollaborationError } from '../../application/whiteboard/collaboration-ports';

function transferFailure(error: unknown): never {
  if (!(error instanceof WhiteboardTransferError)) throw error;
  if (error.code === 'NOT_FOUND') throw new NotFoundException();
  if (error.code === 'FORBIDDEN' || error.code === 'ARCHIVED') throw new ForbiddenException('Whiteboard operation is not allowed');
  if (error.code === 'IDEMPOTENCY_CONFLICT') throw new ConflictException('Request identifier was already used');
  throw new BadRequestException('Portable board package is invalid');
}
function historyFailure(error: unknown): never {
  if (!(error instanceof WhiteboardCollaborationError)) throw error;
  if (error.code === 'NOT_FOUND') throw new NotFoundException();
  if (error.code === 'FORBIDDEN' || error.code === 'ARCHIVED') throw new ForbiddenException('Whiteboard operation is not allowed');
  if (error.code === 'IDEMPOTENCY_CONFLICT' || error.code === 'STALE_EPOCH') throw new ConflictException('Whiteboard history request conflicts with the current head');
  throw new BadRequestException('Whiteboard history request is invalid');
}

/** PrincipalGuard applies globally. Inaccessible boards have the same response as missing boards. */
@Controller('whiteboards')
export class WhiteboardController {
  constructor(@Inject(WHITEBOARD_REPOSITORY) private readonly repo: WhiteboardRepository,
    @Inject(WHITEBOARD_TRANSFER_STORE) private readonly transfer: WhiteboardTransferStore,
    @Inject(WHITEBOARD_HISTORY_STORE) private readonly history: WhiteboardHistoryStore) {}
  @Get()
  async list(@CurrentPrincipal() p: Principal) { assertPrincipal(p); return { items: await this.repo.list(p) }; }
  @Post()
  async create(@CurrentPrincipal() p: Principal, @Body(new ZodBodyPipe(C.CreateBoard)) input: CreateBoard) {
    assertPrincipal(p); return this.repo.create(p,input);
  }
  @Get(':boardId')
  async get(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); const result=await this.repo.get(p,id); if (!result) throw new NotFoundException(); return result;
  }
  @Patch(':boardId')
  async update(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.UpdateBoard)) input: UpdateBoard) {
    assertPrincipal(p); const result=await this.repo.update(p,id,input); if (!result) throw new NotFoundException(); return result;
  }
  @Get(':boardId/members')
  async members(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); const items=await this.repo.members(p,id); if (!items) throw new NotFoundException(); return {items};
  }
  @Put(':boardId/members')
  async putMember(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.Member)) member: Member) {
    assertPrincipal(p); if (!await this.repo.putMember(p,id,member)) throw new NotFoundException(); return {ok:true};
  }
  @Delete(':boardId/members/:userId')
  async removeMember(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string, @Param('userId') userId: string) {
    assertPrincipal(p); if (!await this.repo.removeMember(p,id,userId)) throw new NotFoundException(); return {ok:true};
  }
  @Get(':boardId/checkpoints/head')
  async historyHead(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); try { return await this.history.head(p,id); } catch (error) { historyFailure(error); }
  }
  @Get(':boardId/checkpoints')
  async listCheckpoints(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); try { return {items:await this.history.list(p,id)}; } catch (error) { historyFailure(error); }
  }
  @Post(':boardId/checkpoints')
  async createCheckpoint(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(H.CreateCheckpoint)) input: CreateCheckpointInput) {
    assertPrincipal(p); try { return await this.history.create(p,id,input); } catch (error) { historyFailure(error); }
  }
  @Post(':boardId/checkpoints/compare')
  async compareCheckpoints(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(H.CompareCheckpoint)) input: CompareCheckpointInput) {
    assertPrincipal(p); try { return await this.history.compare(p,id,input); } catch (error) { historyFailure(error); }
  }
  @Get(':boardId/checkpoints/:checkpointId')
  async previewCheckpoint(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string,
    @Param('checkpointId', new ParseUUIDPipe()) checkpointId: string) {
    assertPrincipal(p); try { return await this.history.preview(p,id,checkpointId); } catch (error) { historyFailure(error); }
  }
  @Post(':boardId/checkpoints/:checkpointId/restores')
  async restoreCheckpoint(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string,
    @Param('checkpointId', new ParseUUIDPipe()) checkpointId: string,
    @Body(new ZodBodyPipe(H.RestoreCheckpoint)) input: RestoreCheckpointInput) {
    assertPrincipal(p); try { return await this.history.restore(p,id,checkpointId,input); } catch (error) { historyFailure(error); }
  }
  @Post(':boardId/checkpoints/:checkpointId/copies')
  async copyCheckpoint(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string,
    @Param('checkpointId', new ParseUUIDPipe()) checkpointId: string,
    @Body(new ZodBodyPipe(H.RestoreCheckpoint)) input: RestoreCheckpointInput) {
    assertPrincipal(p); try { return await this.history.copy(p,id,checkpointId,input); } catch (error) { historyFailure(error); }
  }
  @Get(':boardId/export')
  async exportBoard(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); try {
      const bundle=await this.transfer.exportBoard(p,id);
      return new StreamableFile(Buffer.from(JSON.stringify(bundle)), { type:'application/json; charset=utf-8', disposition:'attachment; filename="board.workspacex-board.json"' });
    } catch (error) { transferFailure(error); }
  }
  @Post('imports/preview')
  async previewImport(@CurrentPrincipal() p: Principal, @Body(new ZodBodyPipe(T.ImportBoardInput)) input: T.ImportBoardInput) {
    assertPrincipal(p); try { return await this.transfer.previewImport(p,input); } catch (error) { transferFailure(error); }
  }
  @Post('imports')
  async importBoard(@CurrentPrincipal() p: Principal, @Body(new ZodBodyPipe(T.ImportBoardInput)) input: T.ImportBoardInput) {
    assertPrincipal(p); try { return await this.transfer.importBoard(p,input); } catch (error) { transferFailure(error); }
  }
}
