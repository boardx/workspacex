import { expect, it } from "vitest";
import type { SharedStageValue } from "@repo/contracts/aidt-stages";
import { entityLineage, problemReference } from "../../src/application/aidt-run-context/entity-lineage";

const make=(stageId:number,revision:number,fields:Record<string,string>):SharedStageValue=>({
  projectId:"project", stageId, revision, content:{schemaVersion:1,draft:{fields,ideas:[],selectedIdeaId:""}},
  sourceStageRevisions:[],updatedAt:"2026-11-20T00:00:00Z",updatedBy:"student"
});
const json=JSON.stringify;
it("follows two interviews to the selected historic questions through test, prototype, idea and HMW", async()=>{
  const problem=make(1,7,{"problemDraft:q":json({initial:"你好",rewrittenTheme:"如何确认车道？",scene:"高速施工区"}),"problemDraft:other":json({rewrittenTheme:"无关问题"})});
  const two=make(2,9,{"interviewRecord:a":json({id:"a",topicRevision:7,problemEntityId:"q",code:"U01"}),"interviewRecord:b":json({id:"b",topicRevision:7,problemEntityId:"q",code:"U02"})});
  const three=make(3,5,{definitionEvidenceRevision:"9","definitionHmw:h":json({id:"h",text:"怎样帮助辨认车道",personaIds:["p"],cardIds:["b"]}),"definitionPersona:p":json({id:"p",cardIds:["a"],name:"新手"})});
  const four=make(4,4,{"ideaHmwSource:i":json({id:"h",text:"怎样帮助辨认车道",revision:5}),ideaHmwSource:json({id:"other-hmw",text:"其他点子的问题",revision:6})});
  four.content.draft.ideas.push({id:"i",title:"提示牌",description:"路线提示"});
  const five=make(5,3,{"prototypeEntity:d":json({prototypeIdeaSource:json({revision:4,ideaIds:["i"]})})});
  const six=make(6,2,{"testGroup:t":json({id:"t",prototypeEntity:"d",stage5Revision:3})});
  const rows=[problem,two,three,four,five,six];
  const sources=await entityLineage(six,"t",async (id,revision)=>rows.find(r=>r.stageId===id && r.revision===revision)!);
  expect(sources.map(s=>s.step)).toEqual([1,2,2,3,3,4,5]);
  expect(sources[0]).toMatchObject({content:{"研究问题":"如何确认车道？","具体场景":"高速施工区"},href:"/aidt/project?step=1&entity=q&entityRevision=7"});
  expect(json(sources)).not.toMatch(/无关问题|你好/);
});
it("only recovers a legacy topic by the handoff held in the same revision",async()=>{
  const problem=make(1,3,{problemHandoffEntity:"q","problemDraft:q":json({initial:"你好",rewrittenTheme:"确认"}),"problemDraft:other":json({scene:"不能选它"})});
  const two=make(2,9,{"interviewRecord:i":json({id:"i",topicRevision:3})});
  const sources=await entityLineage(two,"i",async()=>problem,async (stage,id)=>{
    expect(stage.revision).toBe(3);expect(id).toBe("q");return "新手司机夜间行车";
  });
  expect(json(sources)).toContain("新手司机夜间行车"); expect(json(sources)).not.toMatch(/不能选它|你好/);
  delete problem.content.draft.fields.problemHandoffEntity;
  expect(await entityLineage(two,"i",async()=>problem)).toEqual([]);
  expect(problemReference({scene:"确认", initial:" 你好！ ", rewrittenTheme:"为什么需要二次确认？"})).toEqual({"研究问题":"为什么需要二次确认？"});
});
