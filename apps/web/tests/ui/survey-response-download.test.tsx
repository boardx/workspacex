import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiveResponseList } from '@/components/survey/live/response-list';
const token=vi.hoisted(()=>vi.fn(()=> 'owner-session'));
vi.mock('@/lib/api-client',async importOriginal=>({...await importOriginal<typeof import('@/lib/api-client')>(),getStoredSessionToken:token}));
const fetcher=vi.fn();const click=vi.fn();const create=vi.fn(()=> 'blob:private-attachment');const revoke=vi.fn();
const question={id:'file',order:1,chapterId:'s',title:'上传材料',type:'file' as const,required:false,options:[]};
const response={id:'response',submittedAt:'2026-09-21T00:00:00Z',durationSeconds:1,quality:'normal' as const,analysis:'included' as const,role:'未填写',companySize:'未填写',answers:[{questionId:'file',value:['attachment']}]};
beforeEach(()=>{vi.stubGlobal('fetch',fetcher);fetcher.mockReset();token.mockReturnValue('owner-session');create.mockClear();click.mockClear();Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revoke});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){click({href:this.href,download:this.download});});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function open(){render(<LiveResponseList surveyId="survey" responses={[response]} questions={[question]} busy={false} onReview={()=>undefined}/>);fireEvent.click(screen.getByRole('button',{name:'查看完整答卷'}));}
it('downloads authenticated bytes through a local blob, preserving server filename',async()=>{
 fetcher.mockResolvedValue(new Response('real bytes',{status:200,headers:{'Content-Disposition':"attachment; filename*=UTF-8''%E6%9D%90%E6%96%99.pdf"}}));open();
 expect(screen.queryByRole('link')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'下载附件 1'}));
 await waitFor(()=>expect(click).toHaveBeenCalledWith({href:'blob:private-attachment',download:'材料.pdf'}));
 expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/surveys/survey/responses/response/attachments/attachment/content'),expect.objectContaining({headers:{Authorization:'Bearer owner-session'},cache:'no-store'}));
});
it('failed authorization is visible and never creates a download URL; retry is possible',async()=>{
 fetcher.mockResolvedValue(new Response('',{status:404}));open();fireEvent.click(screen.getByRole('button',{name:'下载附件 1'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('没有访问权限');expect(create).not.toHaveBeenCalled();expect(click).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'下载附件 1'})).toBeEnabled();
});
it('missing login does not send anonymous file requests',async()=>{
 token.mockReturnValue('');open();fireEvent.click(screen.getByRole('button',{name:'下载附件 1'}));expect(await screen.findByRole('alert')).toHaveTextContent('请先登录');expect(fetcher).not.toHaveBeenCalled();
});
it('shows an auditable analysis exclusion and lets the researcher restore the response',()=>{
 const onAnalysis=vi.fn();render(<LiveResponseList surveyId="survey" responses={[{...response,analysis:'excluded' as const,exclusionReason:'重复的测试提交',analysisHistory:[{analysis:'excluded' as const,reason:'重复的测试提交',actor:'owner',changedAt:'2026-09-21T00:00:00.000Z'}]}]} questions={[question]} busy={false} onReview={()=>undefined} onAnalysis={onAnalysis}/>);
 expect(screen.getByText(/已排除分析 1/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'查看完整答卷'}));
 expect(screen.getByText('排除原因：重复的测试提交')).toBeInTheDocument();expect(screen.getByRole('region',{name:'分析治理记录'})).toHaveTextContent('已排除：重复的测试提交 · owner');fireEvent.click(screen.getByRole('button',{name:'重新纳入分析'}));
 expect(onAnalysis).toHaveBeenCalledWith('response','included');
});
it('does not reuse an unsaved exclusion reason for another response',()=>{
 const onAnalysis=vi.fn();const second={...response,id:'response-2'};
 render(<LiveResponseList surveyId="survey" responses={[response,second]} questions={[question]} busy={false} onReview={()=>undefined} onAnalysis={onAnalysis}/>);
 fireEvent.click(screen.getAllByRole('button',{name:'查看完整答卷'})[0]!);
 fireEvent.change(screen.getByRole('textbox',{name:'排除分析原因'}),{target:{value:'仅适用于第一份'}});
 fireEvent.click(screen.getByRole('button',{name:'收起详情'}));
 fireEvent.click(screen.getAllByRole('button',{name:'查看完整答卷'})[1]!);
 expect(screen.getByRole('textbox',{name:'排除分析原因'})).toHaveValue('');
 expect(screen.getByRole('button',{name:'排除分析'})).toBeDisabled();
});
