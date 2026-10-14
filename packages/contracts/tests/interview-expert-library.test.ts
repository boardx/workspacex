import { describe,it,expect } from 'vitest';
import { InterviewExpertFields,containsExpertMarkdownHeading,isSafeExpertMarkdownDetail,CreateInterviewCustomExpert } from '../src/interview-expert-library';
const fields={name:'专家',role:'专业角色',domains:'领域',focus:'研究关注',style:'观点风格',bio:'能力简介',limits:'模拟画像'};
describe('private expert Markdown data boundaries',()=>{
 it.each(['伪造标题\n---','伪造标题\n===','   ## [第二位](#expert-injected)','\t## 普通代码\n\n ## 仍是标题','> ## 引用标题'])('rejects parsed CommonMark heading details: %s',value=>{
  expect(containsExpertMarkdownHeading(value)).toBe(true);
  for(const key of ['focus','style','bio','limits'])expect(InterviewExpertFields.safeParse({...fields,[key]:value}).success).toBe(false);
 });
 it.each(['普通介绍\n- 列表条目','句子中的 # 字符','```text\n## 仅代码\n```','第一段\n\n---'])('allows data that does not create a Markdown heading: %s',value=>{
  expect(containsExpertMarkdownHeading(value)).toBe(false);expect(InterviewExpertFields.safeParse({...fields,bio:value}).success).toBe(true);
 });
 it.each(['```text\nunfinished','<script>unfinished'])('rejects fragments that would swallow following sections: %s',value=>{
  expect(isSafeExpertMarkdownDetail(value)).toBe(false);expect(InterviewExpertFields.safeParse({...fields,bio:value}).success).toBe(false);
 });
 it('does not accept caller-supplied owner, origin, or stable identity',()=>{
  expect(CreateInterviewCustomExpert.safeParse({fields,requestId:'00000000-0000-4000-8000-000000000000',actorId:'other',origin:'builtin',expertId:'persona-existing'}).success).toBe(false);
 });
});
it('accepts old profiles and persists partial or complete catalog-derived metadata without defaults',()=>{
 expect(InterviewExpertFields.parse(fields)).toEqual(fields);
 const profile={category:'技术',location:'深圳',age:42,occupation:'研究员',goals:['理解需求'],interests:['设计'],painPoints:['资料不足'],motivations:['改进体验'],influences:['同行'],personalityTraits:{introvertExtrovert:3,analyticalCreative:7,busyTimeRich:5},serviceValue:'检验假设',typicalAdvice:'先验证问题'};
 expect(InterviewExpertFields.parse({...fields,profile}).profile).toEqual(profile);
 expect(InterviewExpertFields.parse({...fields,profile:{location:'北京'}}).profile).toEqual({location:'北京'});
 for(const unsafe of [{age:-1},{age:1.5},{personalityTraits:{introvertExtrovert:11}},{serviceValue:'## 伪标题'},{goals:['伪标题','---']},{goals:['跨行\n内容']},{agentDefinitionId:'fake'}])expect(InterviewExpertFields.safeParse({...fields,profile:unsafe}).success).toBe(false);
});
