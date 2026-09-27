import { expect, it } from 'vitest';
import { createDefaultSurveyReportTemplate, compileSurveyReport } from '../src/survey-report';
it('builds a default optional report from real answer questions only',()=>{
 const questions=[{id:'q1',order:1,chapterId:'g',title:'实际意见',type:'open' as const,required:false,options:[]}];
 const template=createDefaultSurveyReportTemplate('调查',questions);
 const report=compileSurveyReport(template,questions,[{id:'r1',submittedAt:'2026-09-27T00:00:00Z',durationSeconds:10,quality:'normal',analysis:'included',role:'未填写',companySize:'未填写',answers:[{questionId:'q1',value:'实际回答'}]}]);
 expect(report.issues).toEqual([]);
 expect(report.sections[0]!.blocks[0]!.answerTexts).toEqual([{label:'实际意见',value:'实际回答'}]);
});
it('does not reject a default report when an optional question has no answers',()=>{
 const questions=[{id:'q1',order:1,chapterId:'g',title:'意见',type:'open' as const,required:true,options:[]},{id:'q2',order:2,chapterId:'g',title:'选填',type:'open' as const,required:false,options:[]}];
 const responses=[{id:'r1',submittedAt:'2026-09-27T00:00:00Z',durationSeconds:10,quality:'normal' as const,analysis:'included' as const,role:'未填写',companySize:'未填写',answers:[{questionId:'q1',value:'实际回答'}]}];
 const report=compileSurveyReport(createDefaultSurveyReportTemplate('调查',questions,responses),questions,responses);
 expect(report.issues).toEqual([]);
 expect(report.sections.flatMap(section=>section.blocks).flatMap(block=>block.issues)).toEqual([]);
});
