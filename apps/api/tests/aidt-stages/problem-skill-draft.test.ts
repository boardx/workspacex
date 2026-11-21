import {expect,it} from "vitest";
import {projectProblemSkillDraft} from "../../src/application/aidt-stages/problem-skill-draft";
const base={fields:{"problemDraft:p":JSON.stringify({initial:"你好"}),other:"私有草稿"},ideas:[],selectedIdeaId:""};
function turn(user:string,assistant:string,messageId="m1"){return {user,assistant,messageId};}
it("does not convert greetings, unstructured replies, arbitrary fields or a fake confirmation into an outcome",()=>{
 expect(projectProblemSkillDraft(base,"p",turn("你好","### 原始命题\n你好"))).toBeNull();
 expect(projectProblemSkillDraft(base,"p",turn("谢谢","已经确认。"))).toBeNull();
 expect(projectProblemSkillDraft(base,"p",turn("先讨论原因","### 已知\n有一个原因"))).toBeNull();
});
it("restores an existing structured Markdown turn, applies partial patches and preserves the first recorded question",()=>{
 const first=projectProblemSkillDraft(base,"p",turn("夜间通勤","**原始命题**\n夜间通勤\n\n**选题价值**\n有些路口缺少照明\n\n**未知 / 待讨论**\n需要查证"))!;
 const second=projectProblemSkillDraft(first,"p",turn("我们补充具体原因","### 选题价值\n骑车人在暗处不易看清路面","m2"))!;
 expect(JSON.parse(second.fields["problemDraft:p"]!)).toEqual({initial:"夜间通勤",whyWorthStudying:"骑车人在暗处不易看清路面",sourceUncertainty:"需要查证",draftTurnId:"m2"});
 expect(second.fields.other).toBe("私有草稿");
 expect(projectProblemSkillDraft(second,"p",turn("再看一下","### 选题价值\n骑车人在暗处不易看清路面","m3"))).toBeNull();
});
it("keeps the previous confirmed group handoff when material discussion produces a new entity draft",()=>{
 const prior={fields:{"problemDraft:p":JSON.stringify({initial:"夜间通勤",roundCompletion:"old",problemReflectionConfirmed:"true"}),roundCompletion:"old"},ideas:[],selectedIdeaId:""};
 const next=projectProblemSkillDraft(prior,"p",turn("我们想再核实天气","### 待验证\n下雨会否改变结论"))!;
 expect(next.fields.roundCompletion).toBe("old");
 expect(JSON.parse(next.fields["problemDraft:p"]!)).toEqual({initial:"夜间通勤",sourceUncertainty:"下雨会否改变结论",draftTurnId:"m1"});
});
