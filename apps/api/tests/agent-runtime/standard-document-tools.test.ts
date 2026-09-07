import {expect,it,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {DefaultStandardDocumentService} from '../../src/infrastructure/agent-run/standard-document-service';
import {NativeSessionResolved} from '@repo/contracts/native-session-binding';
import type {NativeSessionOwner} from '../../src/application/agent-run/native-session-owner';
import {toOrgId} from '../../src/domain/org-id';
import type {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import type {DocumentSession} from '../../src/application/agent-run/standard-document-tools';
const bytes=Buffer.from('name,value\n甲,10\n');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const path='/inputs/'+'a'.repeat(64)+'/source.csv';
const source={attachmentId:'a1',filename:'source.csv',path,mediaType:'text/csv',sizeBytes:bytes.length,digest:sha(bytes)};
const context={orgId:toOrgId('org'),parentRunId:'run',attemptId:'run:0',leaseEpoch:1,bindingId:randomUUID(),toolCallId:'real-call'};
function setup(){
 const bound=NativeSessionResolved.parse({sessionId:randomUUID(),token:'b'.repeat(64),expiresAt:Date.now()+60000,packageDigest:'c'.repeat(64),interruptOn:{},inputs:[source]});
 const owner={resolve:vi.fn(async()=>bound)} as unknown as NativeSessionOwner;
 const inputs={read:vi.fn(async()=>({manifest:[source],files:[{path,contentBase64:bytes.toString('base64')}]}))};
 const authority={check:vi.fn<ToolExecutionAuthority['check']>().mockResolvedValue({allowed:true})};
 const output=Buffer.from('| name | value |\n|---|---|\n| 甲 | 10 |\n');
 const session={read:vi.fn(async(p:string)=>{const b=p===path?bytes:output;return {path:p,sizeBytes:b.length,contentBase64:b.toString('base64')};}),
  execute:vi.fn<DocumentSession['execute']>().mockImplementation(async input=>({executionId:input.executionId,exitCode:0,output:'',truncated:false,timedOut:false,cancelled:false}))};
 const service=new DefaultStandardDocumentService(owner,inputs,()=>session,authority);
 return {service,session,inputs,owner,authority,output};
}
it('binds actual arguments, quotes fixed CLI argv and verifies output hashes',async()=>{
 const f=setup(),result=await f.service.parse(context,{workspacePath:path});
 expect(result.sourceHash).toBe(source.digest);expect(result.textHash).toBe(sha(f.output));expect(result.warnings).toContain('ocr_not_performed');
 expect(f.authority.check).toHaveBeenCalledWith({...context,toolName:'wx_document_parse',toolArgs:{workspacePath:path}});
 expect(f.session.execute.mock.calls[0]![0].command).toContain("'node' '/opt/sandbox/node_modules/@firecrawl/anydoc/cli.js' '"+path+"' '--format' 'csv' '--output'");
 expect(f.inputs.read).toHaveBeenCalledTimes(2);
});
it('does not run denied, forged, changed or unsupported requests',async()=>{
 const f=setup();f.authority.check.mockResolvedValueOnce({allowed:false,reason:'approval_required'});
 await expect(f.service.parse(context,{workspacePath:path})).rejects.toThrow('denied');expect(f.owner.resolve).not.toHaveBeenCalled();
 await expect(f.service.parse(context,{workspacePath:'/inputs/forged.csv'})).rejects.toThrow('not_bound');
 f.inputs.read.mockResolvedValueOnce({manifest:[{...source,digest:'f'.repeat(64)}],files:[]});
 await expect(f.service.parse(context,{workspacePath:path})).rejects.toThrow('changed');
 await expect(f.service.parse(context,{workspacePath:path,ocr:true} as never)).rejects.toThrow();
 expect(f.session.execute).not.toHaveBeenCalled();
});
it('returns no reference on timeout, bad output or revocation after execution',async()=>{
 const f=setup();f.session.execute.mockResolvedValueOnce({executionId:randomUUID(),exitCode:null,output:'',truncated:false,timedOut:true,cancelled:false});
 await expect(f.service.parse(context,{workspacePath:path})).rejects.toThrow('no_replay');
 const g=setup();g.session.read.mockImplementation(async p=>({path:p,sizeBytes:bytes.length,contentBase64:(p===path?bytes:Buffer.from([255])).toString('base64')}));
 await expect(g.service.parse(context,{workspacePath:path})).rejects.toThrow();
 const h=setup();h.inputs.read.mockResolvedValueOnce({manifest:[source],files:[]}).mockRejectedValueOnce(new Error('current source revoked'));
 await expect(h.service.parse(context,{workspacePath:path})).rejects.toThrow('revoked');
});
