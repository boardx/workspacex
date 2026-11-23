import * as React from 'react';
import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ChatTaskInspector,type ChatTaskInspectorProps} from '@/components/chat/chat-task-inspector';
import {AidtInterviewWorkspace} from '@/features/aidt/components/aidt-interview-workspace';
import {emptyAidtUiDrafts,type AidtUiStageDraft} from '@/features/aidt/lib/aidt-ui-drafts';
import {writeAidtInterview,type AidtInterview,readAidtInterviews} from '@/features/aidt/lib/aidt-interviews';
const mock=vi.hoisted(()=>({mobile:false,listeners:new Set<()=>void>(),token:'synthetic-session',start:vi.fn(),stop:vi.fn(),asr:vi.fn(),readStage:vi.fn(),api:vi.fn()}));
vi.mock('@/components/session/session-provider',()=>({useOptionalSession:()=>({status:'authenticated',session:{currentOrgId:'synthetic-org',userId:'synthetic-student',sessionToken:mock.token}})}));
vi.mock('@/lib/live-recording',()=>({TARGET_SAMPLE_RATE:16000,startCapture:mock.start}));
vi.mock('@/lib/live-asr-draft',()=>({openAsrDraftStream:mock.asr}));
vi.mock('@/features/aidt/lib/live-aidt-stages',()=>({readAidtStage:mock.readStage,listAidtStageHistory:vi.fn(async()=>({items:[]}))}));
vi.mock('@/lib/api-client',async original=>({...await original<typeof import('@/lib/api-client')>(),apiRequest:mock.api}));
vi.mock('next/navigation',()=>({usePathname:()=>'/aidt/synthetic-group',useSearchParams:()=>new URLSearchParams('step=2')}));
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const consent={notes:true,photos:true,audio:true,capture:true,asr:false,observedAt:'2026-11-23T00:00:00Z'};
function record(patch:Partial<AidtInterview>={}):AidtInterview{return{version:1,id,code:'U01',topicRevision:null,topic:'合成问题',goal:'',original:'',adopted:'',guideConfirmed:false,consent,...patch};}
function draft(r=record()){return writeAidtInterview(emptyAidtUiDrafts()[2]!,r);}
const inspector:ChatTaskInspectorProps={hasSelection:true,threadId:'synthetic-thread',projectId:'synthetic-group',artifacts:null,materials:null,loading:false,artifactsError:null,materialsError:null,onRetry:()=>{},pendingMaterialsCount:0,planTodos:null,isRunning:false,runPhaseLabel:null,runStartedAt:null};
let feed:(v:Int16Array)=>void;
function Owner({initial=draft(),readOnly=false,entity=id}:{initial?:AidtUiStageDraft;readOnly?:boolean;entity?:string}){
 const[open,setOpen]=React.useState(true);
 return <ChatTaskInspector {...inspector} hostPanel={{scope:'synthetic-scope',title:'成果',placement:'artifacts',open,onOpenChange:setOpen,content:<p>当前已保存产物</p>,materialsContent:<AidtInterviewWorkspace projectId='synthetic-group' draft={initial} entityId={entity} update={()=>{}} readOnly={readOnly} surface='materials'/>,recordingContent:openMaterials=><AidtInterviewWorkspace projectId='synthetic-group' draft={initial} entityId={entity} update={()=>{}} readOnly={readOnly} surface='recording' openMaterials={openMaterials}/>}}/>;
}
beforeEach(()=>{vi.resetAllMocks();mock.mobile=false;mock.listeners.clear();mock.token='synthetic-session';mock.stop.mockResolvedValue(undefined);mock.start.mockResolvedValue({sourceSampleRate:48000,onFrame:(fn:typeof feed)=>{feed=fn;},stop:mock.stop});mock.readStage.mockResolvedValue({stage:null});mock.api.mockResolvedValue([]);vi.stubGlobal('matchMedia',()=>({get matches(){return mock.mobile},addEventListener:(_:string,fn:()=>void)=>mock.listeners.add(fn),removeEventListener:(_:string,fn:()=>void)=>mock.listeners.delete(fn)}));vi.stubGlobal('URL',class extends URL{static createObjectURL(){return'blob:synthetic'}static revokeObjectURL(){}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function start(){fireEvent.click(screen.getByRole('tab',{name:'录音与转录'}));fireEvent.click(screen.getByRole('button',{name:/^开始录音$/}));await screen.findByText('正在录音 · U01');act(()=>feed(new Int16Array(16000).fill(140)));return screen.getByRole('region',{name:'当前受访者录音'});}
it('real Inspector and recording workspace keep one capture and recorder DOM through tab, fold and desktop/mobile transitions',async()=>{
 const view=render(<Owner/>);const recorder=await start();const timer=within(recorder).getByRole('timer');expect(timer).toHaveTextContent('00:01');
 fireEvent.click(screen.getByRole('tab',{name:/^材料$/}));expect(recorder.isConnected).toBe(true);expect(recorder.closest('[hidden]')).not.toBeNull();expect(mock.stop).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('tab',{name:'录音与转录'}));expect(screen.getByRole('region',{name:'当前受访者录音'})).toBe(recorder);
 fireEvent.click(screen.getByTestId('chat-task-workbench-inspector-collapse'));expect(recorder.isConnected).toBe(true);expect(mock.stop).not.toHaveBeenCalled();
 act(()=>{mock.mobile=true;for(const fn of [...mock.listeners])fn();});fireEvent.click(screen.getByTestId('chat-task-workbench-mobile-open'));fireEvent.click(screen.getByRole('tab',{name:'录音与转录'}));expect(screen.getByRole('region',{name:'当前受访者录音'})).toBe(recorder);expect(timer).toHaveTextContent('00:01');expect(recorder.closest('[role=dialog]')).not.toBeNull();
 act(()=>{mock.mobile=false;for(const fn of [...mock.listeners])fn();});expect(screen.getByRole('region',{name:'当前受访者录音'})).toBe(recorder);expect(mock.start).toHaveBeenCalledOnce();expect(mock.stop).not.toHaveBeenCalled();view.unmount();expect(mock.stop).toHaveBeenCalledOnce();
});
for(const kind of ['audio','capture','asr','readonly','token','entity']as const)it('stops active capture when owned authority or scope changes: '+kind,async()=>{
 const first=kind==='asr'?draft(record({consent:{...consent,asr:true}})):draft();
 const view=render(<Owner initial={first}/>);await start();let next=draft();let entity=id,readOnly=false;
 if(kind==='audio'||kind==='capture')next=draft(record({consent:{...consent,[kind]:false}}));
 if(kind==='asr')next=draft(record({consent:{...consent,asr:false}}));
 if(kind==='readonly')readOnly=true;if(kind==='token')mock.token='different-synthetic-session';
 if(kind==='entity'){entity=other;next=draft(record({id:other,code:'U02'}));}
 view.rerender(<Owner initial={next} readOnly={readOnly} entity={entity}/>);await waitFor(()=>expect(mock.stop).toHaveBeenCalledOnce());expect(mock.asr).not.toHaveBeenCalled();
});
it('photo consent edits keep latest saved revocation and unrelated permissions in real material workspace',()=>{
 let latest=draft(record({consent:{...consent,photos:false}}));const update=vi.fn((fn:(v:AidtUiStageDraft)=>AidtUiStageDraft)=>{latest=fn(latest)});
 const view=render(<AidtInterviewWorkspace projectId='synthetic-group' draft={latest} entityId={id} update={update} readOnly={false} surface='materials'/>);
 fireEvent.click(screen.getByLabelText('已获授权共享照片')); // pending photo grant change
 latest=draft(record({consent:{...consent,photos:false,notes:false,observedAt:'2026-11-23T00:01:00Z'}}));
 view.rerender(<AidtInterviewWorkspace projectId='synthetic-group' draft={latest} entityId={id} update={update} readOnly={false} surface='materials'/>);
 fireEvent.click(screen.getByRole('button',{name:'更新授权记录'}));const saved=readAidtInterviews(latest.fields)[0]!;expect(saved.consent).toMatchObject({photos:false,notes:false,audio:true,capture:true,asr:false});expect(mock.start).not.toHaveBeenCalled();
});
it('revoking online-ASR consent stops both already-started microphone and synthetic stream without upload',async()=>{
 const asrStop=vi.fn(async()=>{});mock.asr.mockResolvedValue({stop:asrStop});
 const view=render(<Owner initial={draft(record({consent:{...consent,asr:true}}))}/>);
 fireEvent.click(screen.getByRole('tab',{name:'录音与转录'}));fireEvent.click(screen.getByRole('checkbox',{name:'本次录音同时请求实时转写'}));fireEvent.click(screen.getByRole('button',{name:/^开始录音$/}));await screen.findByText('正在录音 · U01');expect(mock.asr).toHaveBeenCalledOnce();
 view.rerender(<Owner initial={draft(record({consent:{...consent,asr:false,observedAt:'2026-11-23T00:02:00Z'}}))}/>);
 await waitFor(()=>{expect(mock.stop).toHaveBeenCalledOnce();expect(asrStop).toHaveBeenCalledOnce();});expect(screen.queryByText('正在录音 · U01')).toBeNull();
});
it('unrelated saved photo consent update does not replace the ongoing granted recorder',async()=>{
 const view=render(<Owner/>);const recorder=await start();view.rerender(<Owner initial={draft(record({consent:{...consent,photos:false,observedAt:'2026-11-23T00:03:00Z'}}))}/>);
 expect(screen.getByRole('region',{name:'当前受访者录音'})).toBe(recorder);expect(mock.stop).not.toHaveBeenCalled();expect(mock.start).toHaveBeenCalledOnce();
});
it('recording without capture consent offers the normal materials page and never opens microphone',()=>{
 render(<Owner initial={draft(record({consent:{...consent,capture:false}}))}/>);fireEvent.click(screen.getByRole('tab',{name:'录音与转录'}));expect(screen.getByText('开始前确认授权')).toBeVisible();expect(screen.queryByRole('button',{name:/^开始录音$/})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'查看材料与授权'}));expect(screen.getByRole('tab',{name:/^材料$/})).toHaveAttribute('aria-selected','true');expect(screen.getByText('授权和材料')).toBeVisible();expect(mock.start).not.toHaveBeenCalled();
});
it('observation keeps its existing material/observation-excerpt path without a recording-only artifact substitution',()=>{
 render(<AidtInterviewWorkspace projectId='synthetic-group' draft={draft(record({kind:'observation'}))} entityId={id} update={()=>{}} readOnly={false} surface='materials'/>);
 expect(screen.getByRole('region',{name:'观察工作区'})).toBeVisible();expect(screen.getByText('校对观察摘录')).toBeVisible();expect(screen.getByRole('combobox',{name:'观察记录原件'})).toBeVisible();expect(screen.queryByRole('tab',{name:'录音与转录'})).toBeNull();expect(mock.start).not.toHaveBeenCalled();
});
