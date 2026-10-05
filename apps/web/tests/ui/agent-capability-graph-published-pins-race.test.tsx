import React from "react";
import {it,expect,vi} from "vitest";
import {render,screen,act} from "@testing-library/react";
const pending=vi.hoisted(()=>new Map<string,{resolve:(x:unknown)=>void,reject:(x:unknown)=>void}>());
vi.mock("@/lib/live-agent-capability-graph",()=>({getAgentCapabilityGraph:(id:string)=>new Promise((resolve,reject)=>pending.set(id,{resolve,reject}))}));
vi.mock("@/lib/live-capabilities",()=>({listCapabilities:async()=>[]}));
vi.mock("@/lib/api-client",()=>({ApiError:class extends Error{}}));
vi.mock("@/components/ui/button",()=>({Button:(props:any)=><button {...props}/>}));
vi.mock("next/dynamic",()=>({default:()=>()=>null}));
import {AgentCapabilityGraph} from "@/components/admin/agent-capability-graph";
it("old agent response cannot overwrite current agent error, current empty projection makes no absolute authorization claim",async()=>{
const view=render(<AgentCapabilityGraph orgId="org" agentId="old"/>);
view.rerender(<AgentCapabilityGraph orgId="org" agentId="current"/>);
await act(async()=>pending.get("current")!.reject(new Error("current read failed")));
expect(screen.getByTestId("agent-capability-graph-error").textContent).toContain("current read failed");
await act(async()=>pending.get("old")!.resolve({agentId:"old",name:"old",roleLabel:"",skillMounts:[],toolWhitelist:[]}));
expect(screen.getByTestId("agent-capability-graph-error").textContent).toContain("current read failed");
view.rerender(<AgentCapabilityGraph orgId="org" agentId="third"/>);
await act(async()=>pending.get("third")!.resolve({agentId:"third",name:"third",roleLabel:"",skillMounts:[],toolWhitelist:[]}));
expect(screen.getByTestId("agent-capability-graph-empty").textContent).toContain("能力就绪仍需运行验证");
view.unmount();
});

it('late old agent error cannot replace current ready empty graph',async()=>{
 const view=render(<AgentCapabilityGraph orgId="org" agentId="old-error"/>);view.rerender(<AgentCapabilityGraph orgId="org" agentId="new-ready"/>);
 await act(async()=>pending.get('new-ready')!.resolve({agentId:'new-ready',name:'Current',roleLabel:'',skillMounts:[],toolWhitelist:[]}));
 await act(async()=>pending.get('old-error')!.reject(new Error('old error')));
 expect(screen.queryByTestId('agent-capability-graph-error')).toBeNull();expect(screen.getByTestId('agent-capability-graph-empty')).toBeTruthy();view.unmount();
});
it('pending unresolved records remain explanatory rather than mounted abilities',async()=>{
 const view=render(<AgentCapabilityGraph orgId="org" agentId="pending"/>);
 await act(async()=>pending.get('pending')!.resolve({agentId:'pending',name:'Pending',roleLabel:'',skillMounts:[],toolWhitelist:[],pinnedSkills:[],unresolvedSkillVersionIds:['invisible-version'],pendingSkillBindings:[{stableId:'S064',stableName:'problem-framing',contentDigest:'a'.repeat(64),reason:'missing_version'}]}));
 expect(screen.getByTestId('agent-capability-graph-empty')).toBeTruthy();expect(screen.getByText(/这些绑定不代表可执行能力/)).toBeTruthy();expect(screen.getByText(/待绑定方法.*尚未就绪/)).toBeTruthy();view.unmount();
});
