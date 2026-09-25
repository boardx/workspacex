import { Body, Controller, Delete, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { whiteboard as C } from '@repo/contracts';
import { WHITEBOARD_REPOSITORY, type WhiteboardRepository, type CreateBoard, type UpdateBoard, type Member } from '../../application/whiteboard/ports';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';

/** PrincipalGuard applies globally. Inaccessible boards have the same response as missing boards. */
@Controller('whiteboards')
export class WhiteboardController {
  constructor(@Inject(WHITEBOARD_REPOSITORY) private readonly repo: WhiteboardRepository) {}
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
}
