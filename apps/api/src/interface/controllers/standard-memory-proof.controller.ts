import { timingSafeEqual } from 'node:crypto';
import { Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,ServiceUnavailableException,BadRequestException } from '@nestjs/common';
import { MemoryProofInput } from '@repo/contracts/standard-memory';
import { STANDARD_MEMORY_PROOF,type StandardMemoryProof } from '../../application/agent-run/standard-memory-proof';
import { Public } from '../public.decorator';
@Controller()
export class StandardMemoryProofController {
  constructor(@Inject(STANDARD_MEMORY_PROOF) private readonly proof:StandardMemoryProof|null) {}
  @Public() @Post('/internal/agent-runs/:runId/memory/source-proof') @HttpCode(200)
  async check(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('runId') runId:string,@Body() body:unknown) {
    const expected=Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??''),actual=Buffer.from(key??'');
    if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();
    const parsed=MemoryProofInput.safeParse(body);
    if(!parsed.success||!runId.trim()||runId.length>256)throw new BadRequestException('memory_invalid');
    if(!this.proof)throw new ServiceUnavailableException('memory_unavailable');
    try{return await this.proof.check(runId,parsed.data);}catch{throw new ServiceUnavailableException('memory_refused');}
  }
}
