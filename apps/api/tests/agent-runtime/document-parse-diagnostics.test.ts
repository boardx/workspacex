import {afterEach,expect,it,vi} from 'vitest';
import {Logger} from '@nestjs/common';
import {DocumentParseExecutionError,documentParseFailureReason} from '../../src/application/agent-run/standard-document-tools';
import {StandardDocumentToolsController} from '../../src/interface/controllers/standard-document-tools.controller';
afterEach(()=>vi.restoreAllMocks());
it('does not classify arbitrary provider text or leak document details',()=>{
 expect(documentParseFailureReason(new Error('document_parse_unavailable'))).toBe('runtime_unavailable');
 expect(documentParseFailureReason(new Error('document_parse_denied'))).toBe('denied');
 expect(documentParseFailureReason(new Error('document_parse_input_changed'))).toBe('input_changed');
 for(const value of [new Error('document_parse_unavailable secret=abc'),new Error('document_parse_denied /inputs/private.pdf'),new Error('secret=abc'),new Error('constructor'),'document_parse_denied',null])expect(documentParseFailureReason(value)).toBe('unknown');
});
it('preserves the external refusal while logging only a bounded reason',async()=>{
 const secret='private-document-body-and-credential';
 const log=vi.spyOn(Logger.prototype,'warn').mockImplementation(()=>{});
 const previous=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;
 process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='test-internal-key';
 try{
  for(const error of [new DocumentParseExecutionError('execution_timeout'),new Error(secret)]){
   const parse=vi.fn().mockRejectedValue(error);
   const controller=new StandardDocumentToolsController({parse});
   await expect(controller.parse('test-internal-key','private-run-identifier',{orgId:'org',attemptId:'run:0',leaseEpoch:1,bindingId:'00000000-0000-4000-8000-000000000001',toolCallId:'private-call',toolName:'wx_document_parse',toolArgs:{workspacePath:'/inputs/private.pdf'}})).rejects.toMatchObject({response:{message:'document_parse_failed_no_result_confirmed',statusCode:503}});
   expect(parse).toHaveBeenCalledTimes(1);
  }
  const refusedParse=vi.fn();
  await expect(new StandardDocumentToolsController({parse:refusedParse}).parse('wrong-key','private-run-identifier',{})).rejects.toMatchObject({response:{statusCode:401}});
  expect(refusedParse).not.toHaveBeenCalled();
  expect(log.mock.calls).toEqual([[{event:'document_parse_failed',reason:'execution_timeout'}],[{event:'document_parse_failed',reason:'unknown'}]]);
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
 }finally{if(previous===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=previous;}
});
