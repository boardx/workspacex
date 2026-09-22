import { describe,it,expect } from 'vitest';
import { survey } from '@repo/contracts';
import { remapReportTemplate, requiredTemplateQuestions } from '@/lib/survey/template-reuse';
const questions:survey.SurveyWorkflowQuestion[]=[{id:'old',title:'评分',type:'scale',chapterId:'s',order:1,required:true,options:['1','2','3','4','5']},{id:'group',title:'团队',type:'single',chapterId:'s',order:2,required:true,options:['甲','乙']}];
const template=survey.SurveyReportTemplateSchema.parse({id:'t',title:'报告',sections:[{id:'s',title:'结果',blocks:[{id:'b',title:'得分',type:'bar',questionIds:['old'],groupByQuestionId:'group'}]}]});
describe('portable report bindings',()=>{
 it('requires all value and grouping references and never mutates the source',()=>{
  expect(requiredTemplateQuestions(template)).toEqual(['old','group']);
  const destination=questions.map(q=>({...q,id:'new-'+q.id}));
  const next=remapReportTemplate({questions,template},destination,{old:'new-old',group:'new-group'});
  expect(next.sections[0]!.blocks[0]!.questionIds).toEqual(['new-old']);
  expect(next.sections[0]!.blocks[0]!.groupByQuestionId).toBe('new-group');
  expect(template.sections[0]!.blocks[0]!.questionIds).toEqual(['old']);
  expect(next.id).not.toBe(template.id);
 });
 it('rejects incomplete, deleted, duplicate or incompatible mappings',()=>{
  expect(()=>remapReportTemplate({questions,template},questions,{})).toThrow();
  expect(()=>remapReportTemplate({questions,template},questions,{old:'missing',group:'group'})).toThrow();
  expect(()=>remapReportTemplate({questions,template},questions,{old:'old',group:'old'})).toThrow();
  expect(()=>remapReportTemplate({questions,template},questions,{old:'group',group:'old'})).toThrow();
 });
 it('allows a text-only template without questions',()=>{
  const text=survey.SurveyReportTemplateSchema.parse({id:'text',title:'说明',sections:[{id:'s',title:'说明',blocks:[{id:'b',type:'text',title:'目的',text:'作者内容'}]}]});
  expect(remapReportTemplate({questions:[],template:text},[],{}).sections[0]!.blocks[0]!.text).toBe('作者内容');
 });
});
