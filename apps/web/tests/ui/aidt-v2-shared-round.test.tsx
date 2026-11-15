import * as React from "react";
import { expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAidtSharedStages } from "@/features/aidt/lib/use-aidt-shared-stages";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.read, saveAidtStage: mocks.save }));
it("keeps a test round bound to historical stage5 even after its head changes", async () => {
  const drafts = emptyAidtUiDrafts();
  drafts[6]!.fields = { questionSnapshot: JSON.stringify({ schemaVersion:1, question:"旧问题",beforeTestBelief:"旧预期",verificationBasis:"",verificationLimits:"理解测试",prototypeRef:"纸面V1",sourceStageRevision:1 }), returnReason:"保留第一轮依据" };
  const stage = { projectId:"p",stageId:5,revision:3,updatedBy:"editor",updatedAt:"2026-11-15T00:00:00Z",sourceStageRevisions:[],content:{schemaVersion:1,draft:{...drafts[5]!,fields:{verificationQuestion:"新问题",version:"纸面V3"}}} };
  mocks.read.mockImplementation(async(_p,id)=>({stage:id===5?stage:null}));
  mocks.save.mockImplementation(async(input)=>({stage:{...stage,...input,revision:1},replayed:false}));
  const {result} = renderHook(()=>useAidtSharedStages({enabled:true,scope:{projectId:"p",orgId:"o",userId:"u",sessionToken:"t"},lifecycleKey:"life",stageId:6,drafts,canWrite:true,onHydrate:()=>{}}));
  await waitFor(()=>expect(result.current.read?.phase).toBe("ready"));
  expect(result.current.sourceStageRevisions).toEqual([{stageId:5,revision:1}]);
  act(()=>result.current.chooseSource(5,false));
  expect(result.current.sourceStageRevisions).toEqual([{stageId:5,revision:1}]);
  await act(async()=>result.current.saveCurrent());
  expect(mocks.save.mock.calls[0]![0].sourceStageRevisions).toEqual([{stageId:5,revision:1}]);
  expect(mocks.save.mock.calls[0]![0].content.draft.fields.questionSnapshot).toContain("旧问题");
});

it("pins a student-confirmed unexpected finding to the saved discovery-card revision", async () => {
  vi.clearAllMocks(); const drafts = emptyAidtUiDrafts();
  drafts[3]!.fields = { surpriseStatus:"found", priorBelief:"以为不懂口味", surprisingFinding:"有偏好仍犹豫", surpriseCardIds:'["card-a"]', surpriseSourceRevision:"2", surpriseConfirmed:"true" };
  const stage = { projectId:"p",stageId:2,revision:4,updatedBy:"editor",updatedAt:"2026-11-15T00:00:00Z",sourceStageRevisions:[],content:{schemaVersion:1,draft:drafts[2]!} };
  mocks.read.mockImplementation(async(_p,id)=>({stage:id===2?stage:null}));
  mocks.save.mockImplementation(async(input)=>({stage:{...stage,...input,revision:1},replayed:false}));
  const {result} = renderHook(()=>useAidtSharedStages({enabled:true,scope:{projectId:"p",orgId:"o",userId:"u",sessionToken:"t"},lifecycleKey:"second-life",stageId:3,drafts,canWrite:true,onHydrate:()=>{}}));
  await waitFor(()=>expect(result.current.read?.phase).toBe("ready"));
  expect(result.current.sourceStageRevisions).toEqual([{stageId:2,revision:2}]);
  act(()=>result.current.chooseSource(2,true));
  await act(async()=>result.current.saveCurrent());
  expect(mocks.save.mock.calls[0]![0].sourceStageRevisions).toEqual([{stageId:2,revision:2}]);
});
