import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LiveResponseList } from '@/components/survey/live/response-list';
const token=vi.hoisted(()=>vi.fn(()=> 'owner-session'));
vi.mock('@/lib/api-client',async importOriginal=>({...await importOriginal<typeof import('@/lib/api-client')>(),getStoredSessionToken:token}));
const fetcher=vi.fn();const click=vi.fn();const create=vi.fn(()=> 'blob:private-attachment');const revoke=vi.fn();
const question={id:'file',order:1,chapterId:'s',title:'上传材料',type:'file' as const,required:false,options:[]};
const response={id:'response',submittedAt:'2026-09-21T00:00:00Z',durationSeconds:1,quality:'normal' as const,role:'未填写',companySize:'未填写',answers:[{questionId:'file',value:['attachment']}]};
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
