import { expect, it } from 'vitest';
import { compileSurveyReport, SurveyReportTemplateSchema } from '../src/survey-report';
import type { SurveyResponse, SurveyWorkflowQuestion } from '../src/survey';
const questions: SurveyWorkflowQuestion[] = ['目标清晰', '资源投入'].map((title,i)=>({id:`q${i}`,title,type:'scale',options:['1','2','3','4','5'],required:true,order:i,chapterId:'c'}));
const template=SurveyReportTemplateSchema.parse({id:'t',title:'报告',sections:[{id:'c',title:'战略治理',blocks:questions.map(q=>({id:`b${q.id}`,title:q.title,type:'metric',questionIds:[q.id]}))}]});
const response:SurveyResponse={id:'r',quality:'normal',submittedAt:'2026-09-22',role:'user',companySize:'1',durationSeconds:60,answers:[{questionId:'q0',value:'5'},{questionId:'q1',value:'1'}]};
it('generates grounded section interpretation for one respondent without organizational claims',()=>{
 const report=compileSurveyReport(template,questions,[response]);
 expect(report.issues).toEqual([]);
 const analysis=report.sections[0]!.analysis!;
 expect(analysis.length).toBeGreaterThan(0);
 expect(JSON.stringify(analysis)).toContain('受访者');
 expect(JSON.stringify(analysis)).toContain('资源投入');
 expect(JSON.stringify(analysis)).toContain('5');
 expect(JSON.stringify(analysis)).not.toContain('组织成熟度');
 expect(analysis.every(a=>a.blockIds.length && a.evidence && a.action)).toBe(true);
});
it('allows template opt-out and does not interpret invalid or suppressed data',()=>{
 expect(compileSurveyReport({...template,sections:template.sections.map(s=>({...s,interpretation:false}))},questions,[response]).sections[0]!.analysis).toEqual([]);
 expect(compileSurveyReport(template,questions,[{...response,quality:'review'}]).sections[0]!.analysis).toEqual([]);
});
it('does not compare incompatible scales or expose hidden groups',()=>{
 const mixed=questions.map((q,i)=>i?{...q,options:['1','10']}:q);
 const result=compileSurveyReport(template,mixed,[response]);
 expect(result.sections[0]!.analysis?.some(a=>a.blockIds.length>1)).toBe(false);
 const grouped={...template,sections:template.sections.map(s=>({...s,blocks:s.blocks.map(b=>({...b,groupByQuestionId:'g'}))}))};
 const qs=[...questions,{...questions[0]!,id:'g',type:'single' as const,options:['秘密组']}];
 const r={...response,answers:[...response.answers,{questionId:'g',value:'秘密组'}]};
 expect(compileSurveyReport(grouped,qs,[r]).sections[0]!.analysis).toEqual([]);
});
it('keeps sample counts per question, and uses plural wording for multiple answers',()=>{
 const result=compileSurveyReport(template,questions,[response,{...response,id:'second'}]);
 const text=JSON.stringify(result.sections[0]!.analysis);
 expect(text).toContain('有效作答 2 份');
 expect(text).not.toContain('仅有 1 份');
});
it('summarizes ranking with ascending rank semantics and preserves a single open response',()=>{
 const qs:SurveyWorkflowQuestion[]=[{...questions[0]!,id:'rank',type:'ranking',options:['流程','工具']},{...questions[0]!,id:'feedback',type:'open',options:[]}];
 const t=SurveyReportTemplateSchema.parse({id:'r',title:'报告',sections:[{id:'s',title:'建议',blocks:[{id:'ranking',title:'优先项',type:'table',questionIds:['rank'],statistic:'mean_rank'},{id:'open',title:'具体经历',type:'table',questionIds:['feedback'],statistic:'responses'}]}]});
 const r={...response,answers:[{questionId:'rank',value:['工具','流程']},{questionId:'feedback',value:'找资料需要切换三个系统'}]};
 const result=compileSurveyReport(t,qs,[r]);
 expect(result.issues).toEqual([]);
 expect(result.sections[0]!.analysis![0]!.action).toContain('工具');
 expect(JSON.stringify(result.sections[0]!.analysis)).toContain('找资料需要切换三个系统');
});
it('interprets NPS and multi-question mean tables with one valid answer',()=>{
 const qs=[...questions,{...questions[0]!,id:'nps',title:'推荐',type:'nps' as const,config:{min:0,max:10},options:[]}];
 const t=SurveyReportTemplateSchema.parse({id:'t',title:'报告',sections:[{id:'s',title:'整体感受',blocks:[{id:'multi',title:'战略',type:'table',questionIds:['q0','q1'],statistic:'mean'},{id:'n',title:'推荐',type:'metric',questionIds:['nps'],statistic:'nps'}]}]});
 const r={...response,answers:[...response.answers,{questionId:'nps',value:'9'}]};
 const result=compileSurveyReport(t,qs,[r]);
 expect(result.issues).toEqual([]);
 expect(result.sections[0]!.analysis?.map(a=>a.blockIds[0])).toEqual(['multi','n']);
 expect(result.sections[0]!.analysis![1]!.evidence).toContain('NPS为 100');
});
it.each(['count','sum','first_choice'] as const)('interprets %s without confusing units',statistic=>{
 const q={...questions[0]!,type:statistic==='first_choice'?'ranking' as const:statistic==='sum'?'allocation' as const:'scale' as const};
 const t=SurveyReportTemplateSchema.parse({id:'t',title:'报告',sections:[{id:'s',title:'结果',blocks:[{id:'b',title:'结果',type:'table',questionIds:[q.id],statistic}]}]});
 const r={...response,answers:[{questionId:q.id,value:statistic==='first_choice'?['1','2','3','4','5']:statistic==='sum'?{'1':'1','2':'2','3':'3','4':'4','5':'5'}:'3'}]};
 const result=compileSurveyReport(t,[q],[r]);
 expect(result.issues).toEqual([]);
 expect(result.sections[0]!.analysis).toHaveLength(1);
 expect(result.sections[0]!.analysis![0]!.evidence).toContain('受访者');
});
