import {expect,it,vi} from 'vitest';
import {interviewMarkdown} from '@repo/contracts';
import {repairInterviewAnalysis,INTERVIEW_ANALYSIS_INSTRUCTIONS} from '../../src/application/interview/workflow/interview-analysis-quality';
const complete=()=>interviewMarkdown.INTERVIEW_ANALYSIS_SECTIONS.map(s=>`## ${s.title}\n\n${s.kind === "recommendations" ? "1. 分别招募主动晚睡与轮班人群，追问最近一晚的时间线，以区分个人选择与工作约束。\n2. 请受访者展示一周睡眠记录，比较就寝时间与实际睡眠时长，核验回忆偏差。\n3. 追问晚睡却状态良好的反例，核对休息安排和次日任务，避免只收集负面体验。" : "依据主动晚睡与轮班场景，核实睡眠时长、工作约束与次日行为差异。"}`).join('\n\n');
const request={modelProvider:'fixture',modelId:'fixture',system:'研究分析',user:'原始需求：了解主动晚睡与轮班晚睡的差异，而非预设健康因果。'};
it('keeps a complete generated body byte-for-byte without a second model request',async()=>{
 const model={complete:vi.fn()};const markdown=complete();expect(await repairInterviewAnalysis(model,request,markdown)).toBe(markdown);expect(model.complete).not.toHaveBeenCalled();
});
it('repairs topic-only prose once using the original confirmed request and concrete missing sections',async()=>{
 const model={complete:vi.fn(async (input: typeof request)=>{expect(input.modelProvider).toBe("fixture");return {text:complete()};})};
 expect(await repairInterviewAnalysis(model,request,'# 每天晚睡的弊端\n\n长期睡眠不足可能影响身体。')).toContain('## 研究建议');
 expect(model.complete).toHaveBeenCalledTimes(1);const retry=model.complete.mock.calls[0]![0];expect(retry.user).toContain(request.user);expect(retry.user).toContain('研究建议');expect(retry.system).toContain('完整重写');expect(retry.system).not.toContain('从失败片段续写');
 expect(INTERVIEW_ANALYSIS_INSTRUCTIONS).toContain('主题科普');expect(INTERVIEW_ANALYSIS_INSTRUCTIONS).toContain('输入');
});
it.each([{text:'## 研究建议\n待补充'},{text:complete(),truncated:true},{text:complete(),cancelled:true},{text:complete(),interrupted:{toolName:"read_file",argsSummary:null}},{text:complete(),paused:true}])('rejects incomplete or stopped repair rather than manufacturing meaningful advice %j',async response=>{
 const model={complete:vi.fn(async()=>response)};
 await expect(repairInterviewAnalysis(model,request,'# 科普\n晚睡有危害。')).rejects.toThrow('AI_GENERATION_UNAVAILABLE');expect(model.complete).toHaveBeenCalledTimes(1);
});

it('limits deterministic loopback analysis to the explicit interview operation',async()=>{
 const {loopbackInterviewAnalysis}=await import('../../scripts/loopback-interview-analysis');
 const system='你是专业用户研究员。只输出 Markdown';
 expect(loopbackInterviewAnalysis(system,'操作：generate_report')).toBeNull();
 expect(loopbackInterviewAnalysis('ordinary chat','操作：generate_analysis')).toBeNull();
 const body=loopbackInterviewAnalysis(system,'# 访谈模型上下文\n操作：generate_analysis\n');
 expect(body).toContain('确定性测试提案');
 expect(body).not.toBeNull();
});
