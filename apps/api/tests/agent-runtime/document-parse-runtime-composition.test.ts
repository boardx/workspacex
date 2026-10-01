import 'reflect-metadata';
import {Logger,type FactoryProvider} from '@nestjs/common';
import {afterEach,expect,it,vi} from 'vitest';
import {KernelModule} from '../../src/kernel.module';
import {STANDARD_DOCUMENT_SERVICE,type StandardDocumentService} from '../../src/application/agent-run/standard-document-tools';
import {StandardDocumentToolsController} from '../../src/interface/controllers/standard-document-tools.controller';
afterEach(()=>vi.restoreAllMocks());
it.each(['owner','socket'] as const)('logs missing native %s from the production factory without exposing configuration',async(missing)=>{
 const providers=Reflect.getMetadata('providers',KernelModule) as FactoryProvider[];
 const binding=providers.find(provider=>provider.provide===STANDARD_DOCUMENT_SERVICE)!;
 expect(binding).toBeDefined();
 const priorSocket=process.env.NATIVE_SESSION_SOCKET,priorKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;
 process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='synthetic-internal-key';
 if(missing==='socket')delete process.env.NATIVE_SESSION_SOCKET;else process.env.NATIVE_SESSION_SOCKET='/private/socket-must-never-be-logged';
 const log=vi.spyOn(Logger.prototype,'warn').mockImplementation(()=>{});
 try{
  const service=binding.useFactory(undefined,undefined,missing==='owner'?null:{},undefined,undefined,undefined,undefined) as StandardDocumentService;
  expect(service).not.toBeNull();
  const controller=new StandardDocumentToolsController(service);
  await expect(controller.parse('synthetic-internal-key','private-run',{orgId:'org',attemptId:'run:0',leaseEpoch:1,bindingId:'00000000-0000-4000-8000-000000000001',toolCallId:'private-call',toolName:'wx_document_parse',toolArgs:{workspacePath:'/inputs/private.pdf'}})).rejects.toMatchObject({response:{message:'document_parse_failed_no_result_confirmed',statusCode:503}});
  expect(log.mock.calls).toEqual([[{event:'document_parse_failed',reason:'runtime_unavailable'}]]);
 }finally{
  if(priorSocket===undefined)delete process.env.NATIVE_SESSION_SOCKET;else process.env.NATIVE_SESSION_SOCKET=priorSocket;
  if(priorKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=priorKey;
 }
});
