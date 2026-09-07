import {timingSafeEqual} from 'node:crypto';
import {BadRequestException,Body,Controller,ForbiddenException,Headers,HttpCode,Inject,Param,Post,UnauthorizedException} from '@nestjs/common';
import {StandardArtifactDownloadInvocation} from '@repo/contracts/standard-artifact-download';
import {STANDARD_ARTIFACT_DOWNLOAD,StandardArtifactDownloadService} from '../../application/agent-run/standard-artifact-download';
import {STANDARD_ENTRY_SCOPE,type StandardEntryScope} from '../../application/agent-run/standard-entry-scope';
import {Public} from '../public.decorator';
@Controller() export class StandardArtifactDownloadController {
 constructor(@Inject(STANDARD_ARTIFACT_DOWNLOAD) private readonly service:StandardArtifactDownloadService,@Inject(STANDARD_ENTRY_SCOPE) private readonly scope:StandardEntryScope){}
 @Public() @Post('/internal/agent-runs/:parentRunId/standard-artifact-download/invoke') @HttpCode(200)
 async invoke(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('parentRunId') parentRunId:string,@Body() body:unknown){
  const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
  if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
  const parsed=StandardArtifactDownloadInvocation.safeParse(body);if(!parsed.success)throw new BadRequestException('standard_entry_invalid');
  const input=parsed.data;
  try{return await this.scope.run(parentRunId,input,actor=>this.service.invoke(actor,input.toolArgs));}
  catch{throw new ForbiddenException('standard_entry_refused');}
 }
}
