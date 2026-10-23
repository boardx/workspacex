import {timingSafeEqual} from 'node:crypto';
import {Body,Controller,Headers,HttpCode,Inject,Param,Post,UnauthorizedException,BadRequestException} from '@nestjs/common';
import {AuxiliaryModelAdmission,AuxiliaryModelStart,AuxiliaryModelTerminal} from '@repo/contracts/auxiliary-model-accounting';
import {AUXILIARY_MODEL_ACCOUNTING,type AuxiliaryModelAccounting} from '../../application/billing/auxiliary-model-accounting';
import {toOrgId} from '../../domain/org-id';
import {z} from 'zod';
import {Public} from '../public.decorator';
@Controller()
export class AuxiliaryModelUsageController {
 constructor(@Inject(AUXILIARY_MODEL_ACCOUNTING) private readonly usage:AuxiliaryModelAccounting){}
 private auth(key:string|undefined,id:string){const expected=Buffer.from((process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY??'').trim()),actual=Buffer.from(key??'');if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new UnauthorizedException();if(!z.string().uuid().safeParse(id).success)throw new BadRequestException('invalid_operation');}
 @Public() @Post('/internal/auxiliary-model/:operationId/model-requests/admit') @HttpCode(200)
 async admit(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('operationId') id:string,@Body() body:unknown){this.auth(key,id);const p=AuxiliaryModelAdmission.safeParse(body);if(!p.success)throw new BadRequestException('invalid_admission_request');const {orgId,...input}=p.data;await this.usage.admit(toOrgId(orgId),id,input);return{accepted:true};}
 @Public() @Post('/internal/auxiliary-model/:operationId/model-requests/start') @HttpCode(200)
 async start(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('operationId') id:string,@Body() body:unknown){this.auth(key,id);const p=AuxiliaryModelStart.safeParse(body);if(!p.success)throw new BadRequestException('invalid_usage_receipt');const {orgId,...input}=p.data;await this.usage.start(toOrgId(orgId),id,input);return{accepted:true};}
 @Public() @Post('/internal/auxiliary-model/:operationId/model-requests/terminal') @HttpCode(200)
 async terminal(@Headers('x-deep-agent-internal-key') key:string|undefined,@Param('operationId') id:string,@Body() body:unknown){this.auth(key,id);const p=AuxiliaryModelTerminal.safeParse(body);if(!p.success)throw new BadRequestException('invalid_usage_receipt');const {orgId,...input}=p.data;await this.usage.terminal(toOrgId(orgId),id,input);return{accepted:true};}
}
