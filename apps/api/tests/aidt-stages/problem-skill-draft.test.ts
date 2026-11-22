import {expect,it} from "vitest";
import liveRevision from "../fixtures/aidt-s1-live-revision-45007428075.json";
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

it("accepts only student-authored initial wording and reuses an existing choice id across incremental replies",()=>{
 expect(projectProblemSkillDraft(base,"p",turn("商场照明","### 原始命题\n节目排期"))).toBeNull();
 const earlier={initial:"商场照明",problemDirections:JSON.stringify([{id:"old",source:"group",title:"夜间照明"}])};
 const prior={...base,fields:{"problemDraft:p":JSON.stringify(earlier)}};
 const next=projectProblemSkillDraft(prior,"p",turn("选夜间照明","### 本轮选定方向\n夜间照明"))!;
 expect(JSON.parse(next.fields["problemDraft:p"]!)).toMatchObject({initial:"商场照明",problemDirectionId:"old",focus:"夜间照明"});
});

it("keeps a student's original question and omits the teaching follow-up in the next paragraph",()=>{
 const next=projectProblemSkillDraft(base,"p",turn("学生在哪里停下？","### 原始命题\n学生在哪里停下？\n\n你们是在哪里观察到这个情况的？"))!;
 expect(JSON.parse(next.fields["problemDraft:p"]!).initial).toBe("学生在哪里停下？");
});

it("writes back an explicit student statement even when the Skill replies with plain prose", () => {
 const original = "合成验收数据，非真实访谈。想了解校园午休中，赶课与闲暇两种情境如何影响饮品选择的犹豫。";
 const next = projectProblemSkillDraft(base, "p", turn(original, "你们目前了解到了哪些情况？"))!;
 expect(JSON.parse(next.fields["problemDraft:p"]!)).toMatchObject({ initial: original, draftTurnId: "m1" });
 expect(projectProblemSkillDraft(base, "p", turn("你可以给我们生成一份研究产物吗？", "请先补充命题。"))).toBeNull();
});

it("projects the exact Devapp revision, retaining the original, the student's literal wording and their stated hypothesis", () => {
 const draft = projectProblemSkillDraft(base, "p", turn(liveRevision.initial, "先补充选题价值。", "initial"))!;
 const next = projectProblemSkillDraft(draft, "p", turn(liveRevision.user, liveRevision.assistant, "revision"))!;
 const fields = JSON.parse(next.fields["problemDraft:p"]!);
 const selected = "午休后赶课学生在教学楼下饮品店的选择犹豫";
 expect(fields).toMatchObject({
   initial: liveRevision.initial,
   focus: selected,
   rewrittenTheme: "午休结束前，赶下一节课的学生在教学楼下饮品店如何决定买什么、是否排队或放弃？他们在哪个环节犹豫，当时掌握的信息和剩余时间可能起什么作用？",
   sourceDetails: "这些行为目前只是我们提出的假设。",
   problemSources: '["guess"]',
   draftTurnId: "revision",
 });
 expect(fields.whyWorthStudying).toContain("午休后快上课的学生");
 expect(fields.sourceUncertainty).toContain("尚无真实访谈或观察证据");
 expect(JSON.parse(fields.problemDirections)).toContainEqual({ id: fields.problemDirectionId, title: selected, source: "group" });
 expect(fields.problemReflectionConfirmed).toBeUndefined();
 expect(fields.roundCompletion).toBeUndefined();
 expect(next.fields.other).toBe(base.fields.other);
 expect(projectProblemSkillDraft(next, "p", turn(liveRevision.user, liveRevision.assistant, "revision"))).toBeNull();
});

it("does not derive student evidence from quoted teaching prose or accept a substituted revision", () => {
 const draft = { ...base, fields: { ...base.fields, "problemDraft:p": JSON.stringify({ initial: "夜间照明" }) } };
 const user = "上次引导师的追问（仅供对照）：\n学生的回答：\n这些行为目前只是我们提出的假设。\n\n学生的回答：\n还需要更多讨论。\n学生重写命题：晚间路人如何判断能否看清过街信号？";
 const result = projectProblemSkillDraft(draft, "p", turn(user,
   "### 学生重写命题（逐字保留）\n路人为什么必须使用新应用？\n\n### 待验证\n环境差异"));
 const fields = JSON.parse(result!.fields["problemDraft:p"]!);
 expect(fields.rewrittenTheme).toBeUndefined();
 expect(fields.problemSources).toBeUndefined();
 expect(fields.sourceDetails).toBeUndefined();
});
