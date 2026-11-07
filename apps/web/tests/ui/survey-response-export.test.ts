import {expect,it,vi} from 'vitest';
import {surveyResponseMarkdown} from '@/lib/survey/response-markdown';
it('exports original attachment filename plus stable identifier instead of UUID alone',async()=>{
 const read=vi.fn(async()=>({attachmentId:'file-id',name:'用户反馈.pdf',mime:'application/pdf',sizeBytes:123}));
 const text=await surveyResponseMarkdown([{id:'r1',answers:[{questionId:'q',value:['file-id']}]}] as never,[{id:'q',type:'file',title:'附件',options:[]}] as never,read);
 expect(text).toContain('用户反馈.pdf'); expect(text).toContain('file-id');
 expect(read).toHaveBeenCalledWith('r1','file-id');
 expect(text).not.toContain('Bearer');
});
