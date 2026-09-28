import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,expect,it,vi } from 'vitest';
import { SurveyAiProposal } from '@/components/survey/live/ai-proposal';
const request=vi.hoisted(()=>vi.fn());
const recordings=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/survey/runtime-client',()=>({surveyRequest:request}));
vi.mock('@/lib/live-personal-transcriptions',()=>({listPersonalTranscriptions:recordings}));
const proposal={markdown:'# AI 客户反馈\n\n## recent [open]\n请描述最近一次体验\n',execution:{id:'85f6e172-8b43-4a75-a917-0e91742d1e8c',provider:'configured',modelId:'test',generatedAt:'2026-09-28T00:00:00.000Z'},source:{kind:'text',sha256:'a'.repeat(64)}};
beforeEach(()=>{ request.mockReset(); });
it('does not generate from an old source while a new file is being read',async()=>{
 render(<SurveyAiProposal locked={false} onApply={vi.fn()}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'问卷需求'}),{target:{value:'客户研究'}});
 fireEvent.change(screen.getByLabelText('上传问卷文件'),{target:{files:[new File(['研究内容'],'source.md')]}});
 expect(screen.getByRole('button',{name:'生成问卷'})).toBeDisabled();
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成问卷'})).toBeEnabled());
});
it('selects a saved recording by name instead of requiring an opaque ID',async()=>{
 recordings.mockResolvedValue({items:[{sessionId:'voice-1',name:'客户研究目标',status:'idle'},{sessionId:'active',name:'录音中',status:'recording'}],nextCursor:null});
 request.mockResolvedValue(proposal);render(<SurveyAiProposal locked={false} onApply={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'选择已保存录音'}));
 fireEvent.click(await screen.findByRole('button',{name:'客户研究目标'}));
 expect(screen.queryByRole('button',{name:'录音中'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'生成问卷'}));
 await screen.findByRole('textbox',{name:'AI 提案 Markdown'});
 expect(request.mock.calls[0]?.[1].body.transcriptionId).toBe('voice-1');
});
it('rejects oversized uploads before sending them to the server',()=>{
 render(<SurveyAiProposal locked={false} onApply={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText('上传问卷文件'),{target:{files:[new File([new Uint8Array(262145)],'large.md')]}});
 expect(screen.getByRole('alert')).toHaveTextContent('256 KB');
 expect(request).not.toHaveBeenCalled();
});
it('keeps generated Markdown as a correctable proposal until explicitly applied',async()=>{
 request.mockResolvedValue(proposal);const apply=vi.fn();render(<SurveyAiProposal locked={false} onApply={apply}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'问卷需求'}),{target:{value:'研究客户近期体验'}});
 fireEvent.click(screen.getByRole('button',{name:'生成问卷'}));
 const corrected=await screen.findByRole('textbox',{name:'AI 提案 Markdown'});
 expect(apply).not.toHaveBeenCalled();
 fireEvent.change(corrected,{target:{value:proposal.markdown.replace('最近一次体验','具体建议')}});
 fireEvent.click(screen.getByRole('button',{name:'应用到问卷'}));
 expect(apply).toHaveBeenCalledWith(expect.stringContaining('具体建议'));
});
it('ignores a cancelled late proposal without replacing the current draft',async()=>{
 let finish!:(value:unknown)=>void;request.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const apply=vi.fn();render(<SurveyAiProposal locked={false} onApply={apply}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'问卷需求'}),{target:{value:'客户调研'}});
 fireEvent.click(screen.getByRole('button',{name:'生成问卷'}));
 fireEvent.click(screen.getByRole('button',{name:'取消生成'}));finish(proposal);
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'AI 提案 Markdown'})).not.toBeInTheDocument());
 expect(apply).not.toHaveBeenCalled();
});
