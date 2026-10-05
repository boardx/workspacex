import {Body,Controller,Get,Post,HttpException,Inject,Param,Query,UseGuards,BadRequestException} from "@nestjs/common";
import {operations} from "@repo/contracts/platform-model-test";
import {assertPrincipal,type Principal} from "../../domain/principal";
import {PlatformModelTestError,PLATFORM_MODEL_TEST_SERVICE} from "../../application/model/platform-model-test-ports";
import {PlatformModelTestService} from "../../application/model/platform-model-test";
import {PLATFORM_MODEL_TEST_READ,platformModelTestRecord,type PlatformModelTestReadPort} from "../../application/model/platform-model-test-read-ports";
import {PlatformOperatorGuard} from "../guards/platform-operator.guard";
import {CurrentPrincipal} from "../current-principal.decorator";
@UseGuards(PlatformOperatorGuard)
@Controller()
export class PlatformModelTestController{
 constructor(@Inject(PLATFORM_MODEL_TEST_SERVICE) private readonly service:PlatformModelTestService,
  @Inject(PLATFORM_MODEL_TEST_READ) private readonly reader:PlatformModelTestReadPort){}
 private parse<T>(schema:{safeParse(value:unknown):{success:true;data:T}|{success:false}},value:unknown):T{
  const parsed=schema.safeParse(value);if(!parsed.success)throw new BadRequestException({reasonCode:"TEST_INPUT_INVALID"});return parsed.data;
 }
 private async call<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){
  if(error instanceof PlatformModelTestError){const status=error.code==="TEST_FORBIDDEN"?403:error.code==="TEST_NOT_FOUND"?404:error.code==="TEST_ID_CONFLICT"?409:503;throw new HttpException({reasonCode:error.code},status);}
  throw new HttpException({reasonCode:"TEST_UNAVAILABLE"},503);
 }}
 @Get(operations.candidates.path)
 async candidates(@Query()query:unknown,@CurrentPrincipal()principal:Principal){assertPrincipal(principal);const input=this.parse(operations.candidates.in,query);
  return this.call(async()=>operations.candidates.out.parse(await this.reader.candidates({operatorUserId:principal.userId,orgId:input.orgId})));}
 @Post(operations.start.path)
 async start(@Body()body:unknown,@CurrentPrincipal()principal:Principal){assertPrincipal(principal);const input=this.parse(operations.start.in,body);const actor={operatorUserId:principal.userId,orgId:input.orgId};
  return this.call(async()=>platformModelTestRecord(await this.service.execute(actor,input),await this.reader.readUsageProjection(actor,input.testId)));}
 @Get(operations.get.path)
 async get(@Param("testId")testId:string,@Query()query:unknown,@CurrentPrincipal()principal:Principal){assertPrincipal(principal);
  const input=this.parse(operations.get.in,{...this.parse(operations.candidates.in,query),testId});const actor={operatorUserId:principal.userId,orgId:input.orgId};
  return this.call(async()=>platformModelTestRecord(await this.service.get(actor,testId),await this.reader.readUsageProjection(actor,testId)));}
 @Post(operations.cancel.path)
 async cancel(@Param("testId")testId:string,@Body()body:unknown,@CurrentPrincipal()principal:Principal){assertPrincipal(principal);
  const org=this.parse(operations.cancel.in,body);const input=this.parse(operations.get.in,{...org,testId});const actor={operatorUserId:principal.userId,orgId:input.orgId};
  return this.call(async()=>platformModelTestRecord(await this.service.cancel(actor,testId),await this.reader.readUsageProjection(actor,testId)));}
}
