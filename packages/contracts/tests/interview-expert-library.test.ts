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
