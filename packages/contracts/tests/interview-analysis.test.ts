import {expect,it} from 'vitest';
import {projectInterviewAnalysis,INTERVIEW_ANALYSIS_SECTIONS} from '../src/interview-markdown';
const doc=(markdown:string)=>({documentId:'analysis-test',step:'analysis' as const,version:1,contentHash:'a'.repeat(64),evidenceMode:'simulated' as const,references:[],markdown});
it('rejects topic-only explanation and placeholder sections as incomplete research analysis',()=>{
 const topic=projectInterviewAnalysis(doc('# 每天晚睡的主要弊端\n\n长期晚睡会带来影响。\n\n## 身体健康\n睡眠不足可能影响状态。'));
 expect(topic.missing).toContain('recommendations');expect(topic.missing).toContain('boundaries');
 expect(projectInterviewAnalysis(doc('## 研究建议\n待补充\n\n## 待验证假设\n暂无\n\n## 适用边界\n请补充审阅')).missing).toContain('recommendations');
});
it('keeps nested suggestions and Markdown links once, without trusting code/quote headings',()=>{
 const result=projectInterviewAnalysis(doc('# 研究分析\n\n## 研究建议\n\n### 分组比较\n- 按[晚睡场景](#source-intake)区分主动晚睡与轮班。\n\n## 待验证假设\n需核实晚睡时间是否与实际睡眠时长相关。\n\n## 适用边界\n不能仅凭模拟访谈判断健康因果。\n\n```md\n## 研究目标\n伪造的章节内容\n```'));
 expect(result.sections.filter(s=>s.kind==='recommendations')).toHaveLength(1);
 expect(result.sections.find(s=>s.kind==='recommendations')?.markdown).toContain('[晚睡场景](#source-intake)');
 expect(result.sections.some(s=>s.title==='分组比较')).toBe(false);expect(result.missing).toContain('goal');
});
it('uses one section vocabulary for generated analysis and its display projection',()=>{
 const complete=INTERVIEW_ANALYSIS_SECTIONS.map(s=>`## ${s.title}\n\n${s.kind === "recommendations" ? "1. 分别招募主动晚睡与轮班人群，追问最近一晚的时间线，以区分个人选择与工作约束。\n2. 请受访者展示一周睡眠记录，比较就寝时间与实际睡眠时长，核验回忆偏差。\n3. 追问晚睡却状态良好的反例，核对休息安排和次日任务，避免只收集负面体验。" : "依据用户提供的晚睡场景制定具体访谈行动并核验反例。"}`).join('\n\n');
 expect(projectInterviewAnalysis(doc(complete)).missing).toEqual([]);
});

it('does not mistake a filled-out heading template for actionable recommendations',()=>{
 const template=INTERVIEW_ANALYSIS_SECTIONS.map(s=>`## ${s.title}\n\n进一步研究本次需求，补充信息并验证结果。`).join('\n\n');
 expect(projectInterviewAnalysis(doc(template)).missing).toContain('recommendations');
});

it('does not let a matching H1 title consume required H2 sections',()=>{
 const body=INTERVIEW_ANALYSIS_SECTIONS.map(s=>`## ${s.title}\n\n${s.kind==='recommendations'?'1. 追问最近一次具体决策的参与人和时间线，核验实际发生的行为。\n2. 比较不同场景下的真实经历与约束，寻找能交叉核对的材料。\n3. 追问与初步假设不一致的反例，避免只收集支持性意见。':'这是待人工审阅的研究提案，需要实际访谈材料进一步核实。'}`).join('\n\n');
 const result=projectInterviewAnalysis(doc(`# 研究目标\n\n输入主题说明。\n\n${body}`));
 expect(result.missing).toEqual([]);expect(result.sections.filter(s=>s.kind)).toHaveLength(7);
 expect(result.sections.find(s=>s.title==='研究目标'&&s.kind===null)?.markdown).toBe('输入主题说明。');
});
