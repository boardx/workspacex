import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import type { SharedStageValue } from '@repo/contracts/aidt-stages';
import { projectProblemSkillDraft } from '../../src/application/aidt-stages/problem-skill-draft';
import fixtures from './fixtures/aidt-s1-reflection-actual-turns.json';
type Draft=SharedStageValue['content']['draft'];
type Turn={entityId:string;prompt:string;assistantText:string;assistantMessageId:string};
const turns=fixtures.current;
const initial=(fields:Record<string,string>):Draft=>({fields:{'problemDraft:p':JSON.stringify(fields),untouched:'synthetic-neighbor'},ideas:[],selectedIdeaId:''});
const read=(value:Draft|null,before:Draft):Record<string,string>=>JSON.parse((value??before).fields['problemDraft:p']!);
function actual(rows:readonly Turn[]){const a=rows[0]!,b=rows[1]!;let draft:Draft={fields:{['problemDraft:'+a.entityId]:'{}'},ideas:[],selectedIdeaId:''};for(const row of rows){const next=projectProblemSkillDraft(draft,row.entityId,{user:row.prompt,assistant:row.assistantText,messageId:row.assistantMessageId});assert.ok(next);draft=next;}return {fields:JSON.parse(draft.fields['problemDraft:'+a.entityId]!) as Record<string,string>,draft,first:a,second:b};}
test('actual failed two-turn record recovers student value and own literal provenance without prefilled fields or implicit confirmation',()=>{
 const result=actual(turns),student=result.second.prompt.split(/^学生的回答：\s*$/mu).at(-1)!,fields=result.fields;
 assert.ok(fields.whyWorthStudying);assert.ok(fields.whyWorthStudying.trim());assert.ok(student.includes(fields.whyWorthStudying));assert.equal(fields.problemSources,'["guess"]');assert.ok(fields.sourceDetails);assert.ok(fields.sourceDetails.trim());assert.ok(student.includes(fields.sourceDetails));assert.ok(fields.sourceDetails.includes('选题来源是猜测'));
 assert.equal(fields.initial,turns[0]!.prompt);assert.equal(fields.rewrittenTheme,/^学生重写命题：(.+)$/mu.exec(result.second.prompt)![1]!);assert.equal(fields.focus,/^本组选择的研究方向：(.+)$/mu.exec(result.second.prompt)![1]!);assert.equal(fields.roundCompletion,undefined);assert.equal(fields.problemReflectionConfirmed,undefined);

});
test('the previous genuinely complete run still projects its original value, source and student decisions',()=>{
 const previous=actual(fixtures.previous);assert.ok(previous.fields.whyWorthStudying?.trim());assert.equal(previous.fields.problemSources,'["guess"]');assert.equal(previous.fields.sourceDetails,'这些行为目前只是我们提出的假设。');assert.equal(previous.fields.roundCompletion,undefined);
});
const old={initial:'如何理解校园排队选择？',whyWorthStudying:'合成教学中的时间选择体验',problemSources:'["observation"]',sourceDetails:'学生此前自己保存的合成观察说明',problemDirections:JSON.stringify([{id:'old-direction',title:'原有方向',source:'group'}]),problemDirectionId:'old-direction',focus:'原有方向',rewrittenTheme:'如何理解原有研究方向？'};
const aiOnly='### 来源类型\n我们的猜测\n\n### 来源说明\nAI自行补充：所有学生都在猜测。\n\n### 本组选择的研究方向\nAI的新方向\n\n### 学生重写命题\nAI替学生写的题目';
for(const [name,user]of [
 ['teacher-quoted source','下面仅引用老师的例子，不是本组材料：\n> 来源类型：我们的猜测\n> 来源说明：老师提出的合成例子。\n请先比较方向。'],
 ['AI-only source','请继续整理，但不要补造我们的来源。'],
 ['negated provenance','选题来源不是猜测，我们还没有确定来源。'],
 ['question rather than declaration','选题来源是猜测吗？我们还没有决定。'],
 ['uncertain provenance','选题来源可能是猜测，但还不确定。'],
 ['no evidence alone','目前没有真实观察或访谈材料。'],
 ['evidence insufficient alone','目前证据不足，来源尚未确定。'],
 ['teacher reported in prose','老师说“选题来源是猜测”。我只是转述老师，并未声明本组来源。'],
 ['quoted prior teacher outside actual student section','上次引导师的追问（仅供对照）：\n选题来源是猜测；来源说明是老师的例子。\n学生的回答：\n请先比较不同方向，我们尚未确定来源。'],
] as const)test(name+' cannot replace an existing student source or let AI choose/rewrite',()=>{
 const before=initial(old),projected=projectProblemSkillDraft(before,'p',{user,assistant:aiOnly,messageId:'independent-'+name}),fields=read(projected,before);
 assert.equal(fields.problemSources,old.problemSources);assert.equal(fields.sourceDetails,old.sourceDetails);assert.equal(fields.problemDirectionId,old.problemDirectionId);assert.equal(fields.focus,old.focus);assert.equal(fields.rewrittenTheme,old.rewrittenTheme);assert.equal((projected??before).fields.untouched,before.fields.untouched);assert.equal(fields.roundCompletion,undefined);
});
test('a real explicit natural student guess may update its own provenance while a new direction and rewrite remain unchosen',()=>{
 const user='选题来源是猜测；这是本组用于软件验收的假设。\n我们暂不选择新的方向，也暂不重写命题。',before=initial(old),projected=projectProblemSkillDraft(before,'p',{user,assistant:aiOnly,messageId:'independent-explicit-guess'});assert.ok(projected);const fields=read(projected,before);assert.equal(fields.problemSources,'["guess"]');assert.ok(fields.sourceDetails);assert.ok(user.includes(fields.sourceDetails));assert.ok(fields.sourceDetails.includes('选题来源是猜测'));assert.equal(fields.focus,old.focus);assert.equal(fields.rewrittenTheme,old.rewrittenTheme);assert.equal(fields.problemDirectionId,old.problemDirectionId);assert.equal(fields.problemReflectionConfirmed,undefined);assert.equal(fields.roundCompletion,undefined);
});
for(const [name,user]of [
 ['following separate-line attribution','选题来源是猜测；附件只是合成材料。\n以上是老师的示例，不是我们小组的来源。'],
 ['following same-line attribution','选题来源是猜测；附件只是合成材料。以上是老师的示例，不是我们小组的来源。'],
] as const)test(name+' prevents teacher prose from replacing saved student provenance',()=>{
 const before=initial(old),projected=projectProblemSkillDraft(before,'p',{user,assistant:aiOnly,messageId:'independent-backward-'+name}),fields=read(projected,before);assert.equal(fields.problemSources,old.problemSources);assert.equal(fields.sourceDetails,old.sourceDetails);assert.equal(fields.focus,old.focus);assert.equal(fields.rewrittenTheme,old.rewrittenTheme);
});
test('a true student source sentence is retained when the following preface introduces only the next teacher example',()=>{
 const own='选题来源是猜测；这是本组用于软件验收的假设。',user=own+'\n下面仅引用老师的例子，不是本组材料：\n选题来源是猜测；老师用另一个合成场景作解释。',before=initial(old),projected=projectProblemSkillDraft(before,'p',{user,assistant:aiOnly,messageId:'independent-next-example'});assert.ok(projected);const fields=read(projected,before);assert.equal(fields.problemSources,'["guess"]');assert.equal(fields.sourceDetails,own);
});
test('a later undecided-source statement prevents a contradictory earlier guess from overwriting saved provenance',()=>{
 const user='选题来源是猜测。我们还没有确定选题来源。',before=initial(old),projected=projectProblemSkillDraft(before,'p',{user,assistant:aiOnly,messageId:'independent-undecided-source'}),fields=read(projected,before);assert.equal(fields.problemSources,old.problemSources);assert.equal(fields.sourceDetails,old.sourceDetails);
});
test('an unverified guess remains the student-declared source rather than an undecided source',()=>{
 const user='选题来源是猜测。这个猜测还没有真实访谈验证。',before=initial(old),projected=projectProblemSkillDraft(before,'p',{user,assistant:aiOnly,messageId:'independent-unverified-guess'});assert.ok(projected);const fields=read(projected,before);assert.equal(fields.problemSources,'["guess"]');assert.ok(fields.sourceDetails);assert.ok(user.includes(fields.sourceDetails));assert.ok(fields.sourceDetails.includes('选题来源是猜测'));assert.equal(fields.roundCompletion,undefined);assert.equal(fields.problemReflectionConfirmed,undefined);
});
