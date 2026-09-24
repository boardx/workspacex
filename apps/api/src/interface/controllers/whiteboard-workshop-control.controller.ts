import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { whiteboardWorkshopControl as W } from '@repo/contracts';
import { getWorkshopControl, hideWorkshopPhases, revealWorkshopPhases, setWorkshopFreeze } from '../../application/whiteboard/workshop-control';
import { WORKSHOP_CONTROL_REPOSITORY, WorkshopControlError, type WorkshopControlRepository } from '../../application/whiteboard/workshop-control-ports';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';

function failure(error: unknown): never {
  if (!(error instanceof WorkshopControlError)) throw error;
  if (error.code === 'NOT_FOUND') throw new NotFoundException({ code: 'WORKSHOP_CONTROL_NOT_FOUND' });
  if (error.code === 'FORBIDDEN') throw new ForbiddenException({ code: 'WORKSHOP_CONTROL_FORBIDDEN' });
  if (error.code === 'IDEMPOTENCY_CONFLICT') throw new ConflictException({ code: 'WORKSHOP_CONTROL_IDEMPOTENCY_CONFLICT' });
  throw new BadRequestException({ code: 'WORKSHOP_CONTROL_VALIDATION_FAILED' });
}

@Controller('whiteboards/:boardId/workshop/control')
export class WhiteboardWorkshopControlController {
  constructor(@Inject(WORKSHOP_CONTROL_REPOSITORY) private readonly repository: WorkshopControlRepository) {}

  @Get()
  async get(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string) {
    assertPrincipal(p); try { return await getWorkshopControl(this.repository, p, boardId); } catch (error) { failure(error); }
  }
  @Put('freeze')
  async freeze(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Body(new ZodBodyPipe(W.SetWorkshopFreeze)) input: W.SetWorkshopFreeze) {
    assertPrincipal(p); try { return await setWorkshopFreeze(this.repository, p, boardId, input); } catch (error) { failure(error); }
  }
  @Put('hidden-phases')
  async hide(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Body(new ZodBodyPipe(W.HideWorkshopPhases)) input: W.HideWorkshopPhases) {
    assertPrincipal(p); try { return await hideWorkshopPhases(this.repository, p, boardId, input); } catch (error) { failure(error); }
  }
  @Post('reveal')
  async reveal(@CurrentPrincipal() p: Principal, @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Body(new ZodBodyPipe(W.RevealWorkshopPhases)) input: W.RevealWorkshopPhases) {
    assertPrincipal(p); try { return await revealWorkshopPhases(this.repository, p, boardId, input); } catch (error) { failure(error); }
  }
}
