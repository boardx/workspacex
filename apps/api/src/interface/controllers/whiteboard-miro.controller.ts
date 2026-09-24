import { Controller, Delete, ForbiddenException, Get, HttpException, Inject, Post, Query, Body } from '@nestjs/common';
import { whiteboardMiro as C } from '@repo/contracts';
import { WHITEBOARD_MIRO_IMPORT, MiroImportError } from '../../application/whiteboard/miro-ports';
import { MiroDirectImport } from '../../application/whiteboard/miro-direct-import';
import { assertPrincipal, type Principal } from '../../domain/principal';
import { CurrentPrincipal } from '../current-principal.decorator';
import { ZodBodyPipe } from '../pipes/zod-body.pipe';

function failure(error:unknown):never {
  if (!(error instanceof MiroImportError)) throw error;
  const status=error.code==='NOT_CONNECTED'||error.code==='REMOTE_UNAUTHORIZED'?401:
    error.code==='OAUTH_STATE_INVALID'?403:error.code==='REMOTE_RATE_LIMITED'?429:
    error.code==='REMOTE_TIMEOUT'||error.code==='REMOTE_UNAVAILABLE'?503:
    error.code==='ITEM_LIMIT_EXCEEDED'||error.code==='PAYLOAD_TOO_LARGE'?413:400;
  throw new HttpException({reasonCode:error.code},status);
}

@Controller('whiteboards/miro')
export class WhiteboardMiroController {
  constructor(@Inject(WHITEBOARD_MIRO_IMPORT) private readonly miro:MiroDirectImport) {}
  @Get('connection') async connection(@CurrentPrincipal() p:Principal){assertPrincipal(p);return this.miro.connection(p);}
  @Post('oauth/start') async start(@CurrentPrincipal() p:Principal,@Body(new ZodBodyPipe(C.StartMiroOAuthInput)) input:C.StartMiroOAuthInput){assertPrincipal(p);try{return await this.miro.start(p,input);}catch(error){failure(error);}}
  @Post('oauth/callback') async callback(@CurrentPrincipal() p:Principal,@Body(new ZodBodyPipe(C.CompleteMiroOAuthInput)) input:C.CompleteMiroOAuthInput){assertPrincipal(p);try{return C.CompleteMiroOAuthResult.parse(await this.miro.callback(p,input.state,input.code));}catch(error){failure(error);}}
  @Get('boards') async boards(@CurrentPrincipal() p:Principal,@Query() query:unknown){assertPrincipal(p);try{return await this.miro.listBoards(p,query);}catch(error){failure(error);}}
  @Post('imports/preview') async preview(@CurrentPrincipal() p:Principal,@Body(new ZodBodyPipe(C.PreviewMiroBoardInput)) input:C.PreviewMiroBoardInput){assertPrincipal(p);try{return await this.miro.preview(p,input);}catch(error){failure(error);}}
  @Delete('connection') async disconnect(@CurrentPrincipal() p:Principal){assertPrincipal(p);try{return await this.miro.disconnect(p);}catch(error){if(error instanceof MiroImportError&&error.code==='NOT_CONNECTED')throw new ForbiddenException();failure(error);}}
}
