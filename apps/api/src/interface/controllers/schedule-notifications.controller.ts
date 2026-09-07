import {Body,BadRequestException,Controller,ForbiddenException,Get,HttpCode,Inject,NotFoundException,Post,Query,ServiceUnavailableException} from '@nestjs/common';
import {ScheduleNotificationListInput,ScheduleNotificationReadInput,ScheduleNotificationReadOutput} from '@repo/contracts/schedule-notifications';
import {SCHEDULE_NOTIFICATIONS,ScheduleNotificationForbiddenError,ScheduleNotificationNotFoundError,type ScheduleNotifications} from '../../application/agent-run/schedule-notifications';
import {assertPrincipal,type Principal} from '../../domain/principal';
import {CurrentPrincipal} from '../current-principal.decorator';
@Controller('/schedule-notifications')
export class ScheduleNotificationsController {
 constructor(@Inject(SCHEDULE_NOTIFICATIONS) private readonly notifications:ScheduleNotifications|null){}
 @Get()
 async list(@CurrentPrincipal() principal:Principal|null,@Query() query:unknown){
  assertPrincipal(principal);
  const input=ScheduleNotificationListInput.safeParse(query);
  if(!input.success)throw new BadRequestException();
  return this.map(()=>this.requireService().list(principal,input.data));
 }
 @Post('/read') @HttpCode(200)
 async markRead(@CurrentPrincipal() principal:Principal|null,@Body() body:unknown){
  assertPrincipal(principal);
  const input=ScheduleNotificationReadInput.safeParse(body);
  if(!input.success)throw new BadRequestException();
  return this.map(async()=>ScheduleNotificationReadOutput.parse(await this.requireService().markRead(principal,input.data)));
 }
 private requireService(){if(!this.notifications)throw new ServiceUnavailableException();return this.notifications;}
 private async map<T>(action:()=>Promise<T>):Promise<T>{
  try{return await action();}catch(error){
   if(error instanceof ScheduleNotificationForbiddenError)throw new ForbiddenException();
   if(error instanceof ScheduleNotificationNotFoundError)throw new NotFoundException();
   throw error;
  }
 }
}
