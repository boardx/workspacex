import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  WHITEBOARD_ACTOR_SERVICE,
  type WhiteboardActorService,
} from '../../application/whiteboard/actor-service';
import { WhiteboardOperationError } from '../../application/whiteboard/operation-service';
import type { Principal } from '../../domain/principal';
import { assertPrincipal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';

/**
 * Controller contract for owner-managed, board-bound service actors.
 *
 * This controller intentionally remains outside KernelModule until the reviewed
 * digest-only PostgreSQL adapter and tenant RLS migration are explicitly
 * approved. Keeping the HTTP surface here lets contract/unit tests review the
 * boundary without exposing an endpoint backed by incomplete persistence.
 */
@Controller('v1/whiteboards/:boardId')
export class WhiteboardServiceActorController {
  constructor(
    @Inject(WHITEBOARD_ACTOR_SERVICE)
    private readonly actors: WhiteboardActorService,
  ) {}

  @Post('actors/service')
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    try {
      return await this.actors.create(principal, boardId, body);
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Get('actors/service')
  async list(
    @CurrentPrincipal() principal: Principal,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await this.actors.list(principal, boardId);
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Delete('actors/service/:actorId')
  @HttpCode(200)
  async revoke(
    @CurrentPrincipal() principal: Principal,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Param('actorId', new ParseUUIDPipe()) actorId: string,
  ) {
    assertPrincipal(principal);
    try {
      return await this.actors.revoke(principal, boardId, actorId);
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Get('service/objects')
  async objects(
    @CurrentPrincipal() principal: Principal,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Headers('x-board-actor-credential') credential?: string,
  ) {
    assertPrincipal(principal);
    try {
      return await this.actors.readObjects(principal, boardId, credential);
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Post('service/operations')
  async execute(
    @CurrentPrincipal() principal: Principal,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Headers('x-board-actor-credential') credential: string | undefined,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    try {
      return await this.actors.execute(principal, boardId, credential, body);
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Post('service/operations/:operationId/undo')
  async undo(
    @CurrentPrincipal() principal: Principal,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Param('operationId', new ParseUUIDPipe()) operationId: string,
    @Headers('x-board-actor-credential') credential: string | undefined,
    @Body() body: unknown,
  ) {
    assertPrincipal(principal);
    try {
      return await this.actors.undo(principal, boardId, operationId, credential, body);
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Get('service/events')
  async events(
    @CurrentPrincipal() principal: Principal,
    @Param('boardId', new ParseUUIDPipe()) boardId: string,
    @Headers('x-board-actor-credential') credential: string | undefined,
    @Query('afterSeq') afterSeq?: string,
    @Query('limit') limit?: string,
    @Query('afterEpoch') afterEpoch?: string,
  ) {
    assertPrincipal(principal);
    try {
      return await this.actors.events(principal, boardId, credential, {
        afterSeq: afterSeq === undefined ? 0 : Number(afterSeq),
        limit: limit === undefined ? 100 : Number(limit),
        afterEpoch: afterEpoch === undefined ? 1 : Number(afterEpoch),
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (error instanceof WhiteboardOperationError) {
      if (error.code === 'UNAUTHENTICATED') throw new UnauthorizedException();
      if (error.code === 'FORBIDDEN') throw new ForbiddenException();
      if (error.code === 'NOT_FOUND') throw new NotFoundException();
      if (error.code === 'DEPENDENCY_UNAVAILABLE') throw new ServiceUnavailableException();
      if (error.code === 'ARCHIVED') throw new ConflictException(error.code);
      throw new BadRequestException();
    }
    if (error instanceof Error && error.name === 'ZodError') throw new BadRequestException();
    throw error;
  }
}
