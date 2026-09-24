import { Body, Controller, Delete, HttpCode, HttpException, HttpStatus, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { whiteboardRoom as C } from '@repo/contracts';
import { WHITEBOARD_ROOM_REPOSITORY, WhiteboardRoomError, type WhiteboardRoomRepository } from '../../application/whiteboard/room-ports';
import { WhiteboardRoomAccess } from '../../application/whiteboard/room-access';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';
import { Public } from '../public.decorator';

@Controller()
export class WhiteboardRoomController {
  private readonly access: WhiteboardRoomAccess;
  constructor(@Inject(WHITEBOARD_ROOM_REPOSITORY) rooms: WhiteboardRoomRepository) { this.access=new WhiteboardRoomAccess(rooms); }
  private async hide<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if(error instanceof WhiteboardRoomError && error.code==='rate_limited') throw new HttpException('room_pairing_unavailable',HttpStatus.TOO_MANY_REQUESTS);
      if(error instanceof WhiteboardRoomError) throw new NotFoundException('room_pairing_unavailable');
      throw error;
    }
  }
  @Post('/whiteboards/:boardId/room-pairings')
  create(@CurrentPrincipal() p: Principal, @Param('boardId',new ParseUUIDPipe()) boardId:string, @Body(new ZodBodyPipe(C.CreatePairing)) input: unknown) {
    assertPrincipal(p); return this.hide(()=>this.access.createPairing(p,boardId,C.CreatePairing.parse(input)));
  }
  @Post('/whiteboards/:boardId/room-pairings/:pairingId/status') @HttpCode(200)
  status(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Param('pairingId',new ParseUUIDPipe()) pairingId:string){assertPrincipal(p);return this.hide(()=>this.access.pairingStatus(p,boardId,pairingId));}
  @Public() @Post('/whiteboard-room/join') @HttpCode(200)
  join(@Req() req: Request, @Body(new ZodBodyPipe(C.JoinRoom)) input: unknown) {
    const source=`${req.ip ?? 'unknown'}:${String(req.headers['user-agent']??'unknown').slice(0,200)}`;
    return this.hide(()=>this.access.join(C.JoinRoom.parse(input),source));
  }
  @Public() @Post('/whiteboard-room/:sessionId/state') @HttpCode(200)
  read(@Param('sessionId',new ParseUUIDPipe()) sessionId:string,@Body(new ZodBodyPipe(C.RoomCredential)) input:unknown){
    return this.hide(()=>this.access.read(sessionId,C.RoomCredential.parse(input)));
  }
  @Put('/whiteboards/:boardId/room-sessions/:sessionId/viewport')
  publish(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Param('sessionId',new ParseUUIDPipe()) sessionId:string,@Body(new ZodBodyPipe(C.PublishViewport)) input:unknown){
    assertPrincipal(p); return this.hide(()=>this.access.publishViewport(p,boardId,sessionId,C.PublishViewport.parse(input)));
  }
  @Delete('/whiteboards/:boardId/room-sessions/:sessionId')
  async revoke(@CurrentPrincipal() p:Principal,@Param('boardId',new ParseUUIDPipe()) boardId:string,@Param('sessionId',new ParseUUIDPipe()) sessionId:string){
    assertPrincipal(p); if(!await this.access.revoke(p,boardId,sessionId))throw new NotFoundException(); return {ok:true as const};
  }
}
