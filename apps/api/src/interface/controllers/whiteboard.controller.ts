import {
  Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { whiteboard as C } from '@repo/contracts';
import {
  DUPLICATE_BOARD_SERVICE,
  WHITEBOARD_REPOSITORY,
  WHITEBOARD_TAG_REPOSITORY,
  WhiteboardResourceError,
  type CreateBoard,
  type CreateBoardTag,
  type DeleteBoard,
  type DeleteBoardTag,
  type DuplicateBoard,
  type DuplicateBoardService,
  type ListBoards,
  type Member,
  type RenameBoardTag,
  type UpdateBoard,
  type WhiteboardRepository,
  type WhiteboardTagRepository,
} from '../../application/whiteboard/ports';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';

function resourceError(error: unknown): never {
  if (error instanceof WhiteboardResourceError) {
    if (error.code === 'NOT_FOUND' || error.code === 'TAG_NOT_FOUND') throw new NotFoundException({reasonCode:error.code});
    throw new ConflictException({reasonCode:error.code});
  }
  throw error;
}
function parseListQuery(raw: Record<string,string|string[]|undefined>): ListBoards {
  const tagIds = raw.tagIds === undefined ? undefined : Array.isArray(raw.tagIds) ? raw.tagIds : [raw.tagIds];
  return new ZodBodyPipe(C.ListBoards).transform({...raw,tagIds}) as ListBoards;
}

/** PrincipalGuard applies globally. Inaccessible boards share missing-resource responses. */
@Controller('whiteboards')
export class WhiteboardController {
  constructor(
    @Inject(WHITEBOARD_REPOSITORY) private readonly repo: WhiteboardRepository,
    @Inject(DUPLICATE_BOARD_SERVICE) private readonly duplicates: DuplicateBoardService,
  ) {}

  @Get()
  async list(@CurrentPrincipal() p: Principal, @Query() raw: Record<string,string|string[]|undefined>) {
    assertPrincipal(p); try { return await this.repo.list(p,parseListQuery(raw)); } catch (error) { resourceError(error); }
  }
  @Post()
  async create(@CurrentPrincipal() p: Principal, @Body(new ZodBodyPipe(C.CreateBoard)) input: CreateBoard) {
    assertPrincipal(p); return this.repo.create(p,input);
  }
  @Get(':boardId')
  async get(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); const result=await this.repo.get(p,id); if (!result) throw new NotFoundException(); return result;
  }
  @Patch(':boardId')
  async update(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.UpdateBoard)) input: UpdateBoard) {
    assertPrincipal(p); try { const result=await this.repo.update(p,id,input); if (!result) throw new NotFoundException(); return result; }
    catch (error) { resourceError(error); }
  }
  @Post(':boardId/duplicates')
  async duplicate(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.DuplicateBoard)) input: DuplicateBoard) {
    assertPrincipal(p); try { return await this.duplicates.duplicate(p,id,input); } catch (error) { resourceError(error); }
  }
  @Delete(':boardId')
  async delete(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.DeleteBoard)) input: DeleteBoard) {
    assertPrincipal(p); try { const result=await this.repo.permanentlyDelete(p,id,input); if (!result) throw new NotFoundException(); return result; }
    catch (error) { resourceError(error); }
  }
  @Get(':boardId/members')
  async members(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string) {
    assertPrincipal(p); const items=await this.repo.members(p,id); if (!items) throw new NotFoundException(); return {items};
  }
  @Put(':boardId/members')
  async putMember(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.Member)) member: Member) {
    assertPrincipal(p); if (!await this.repo.putMember(p,id,member)) throw new NotFoundException(); return {ok:true};
  }
  @Delete(':boardId/members/:userId')
  async removeMember(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) id: string, @Param('userId') userId: string) {
    assertPrincipal(p); if (!await this.repo.removeMember(p,id,userId)) throw new NotFoundException(); return {ok:true};
  }
}

@Controller('whiteboard-tags')
export class WhiteboardTagController {
  constructor(@Inject(WHITEBOARD_TAG_REPOSITORY) private readonly tags: WhiteboardTagRepository) {}
  @Get()
  async list(@CurrentPrincipal() p: Principal) { assertPrincipal(p); return {items:await this.tags.listTags(p)}; }
  @Post()
  async create(@CurrentPrincipal() p: Principal, @Body(new ZodBodyPipe(C.CreateBoardTag)) input: CreateBoardTag) {
    assertPrincipal(p); try { return await this.tags.createTag(p,input); } catch (error) { resourceError(error); }
  }
  @Patch(':tagId')
  async rename(@CurrentPrincipal() p: Principal, @Param('tagId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.RenameBoardTag)) input: RenameBoardTag) {
    assertPrincipal(p); try { const result=await this.tags.renameTag(p,id,input); if (!result) throw new NotFoundException(); return result; }
    catch (error) { resourceError(error); }
  }
  @Delete(':tagId')
  async delete(@CurrentPrincipal() p: Principal, @Param('tagId',new ParseUUIDPipe()) id: string,
    @Body(new ZodBodyPipe(C.DeleteBoardTag)) input: DeleteBoardTag) {
    assertPrincipal(p); try { const result=await this.tags.deleteTag(p,id,input); if (!result) throw new NotFoundException(); return result; }
    catch (error) { resourceError(error); }
  }
}
