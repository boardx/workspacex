import {it,expect} from 'vitest';
import {attachmentExtractionPresentation} from '../../src/application/chat/attachment-extraction-presentation';
import {PgChatMessageCommandRepository} from '../../src/infrastructure/chat/pg-chat-message-command-repository';
import type {DatabasePort} from '../../src/application/ports/database.port';
import {toOrgId} from '../../src/domain/org-id';
it('projects only closed public extraction statuses and errors',()=>{expect(attachmentExtractionPresentation('failed','credit_required')).toEqual({extractionStatus:'failed',extractionError:'credit_required'});expect(attachmentExtractionPresentation('failed','provider credential PRIVATE')).toEqual({extractionStatus:'failed',extractionError:'extraction_failed'});expect(attachmentExtractionPresentation('unknown','credit_required')).toEqual({});});
it('message attachment read includes the persisted credit failure, not source content or credentials',async()=>{
 const db={withTenant:async(_org:unknown,run:(session:unknown)=>unknown)=>run({query:async()=>({rows:[{message_id:'msg',id:'att',filename:'notes',mime:'text/plain',bytes:'20',created_at:new Date('2026-10-23T00:00:00Z'),extraction_status:'failed',extraction_error:'credit_required'}]})})} as unknown as DatabasePort;
 const result=await new PgChatMessageCommandRepository(db).attachmentsByMessage(toOrgId('org'),['msg']);expect(result.get('msg')?.[0]).toMatchObject({id:'att',extractionStatus:'failed',extractionError:'credit_required'});
});
