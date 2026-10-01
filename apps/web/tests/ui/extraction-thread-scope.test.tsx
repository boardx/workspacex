import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
const css=vi.hoisted(()=>require.resolve('@copilotkit/react-core/v2/styles.css'));
vi.mock(css,()=>({}));
import {CopilotChatMessageView,CopilotChatConfigurationProvider,CopilotKit} from '@copilotkit/react-core/v2';
import {UserMessageAttachmentsCtx,V2UserMessage} from '@/components/chat/copilotkit-v2-user-message';
import {ExtractionFeedbackChip} from '@/components/chat/knowledge/extraction-feedback-chip';
import {SESSION_TOKEN_STORAGE_KEY} from '@/lib/api-client';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
let paths:string[];
function view(threadId:string,sent=true){return <CopilotKit runtimeUrl='/api/copilotkit' useSingleEndpoint={false}><CopilotChatConfigurationProvider agentId='default' threadId='framework-thread'><UserMessageAttachmentsCtx.Provider value={{threadId,byMessageId:new Map(),sentThisSession:new Set(sent?['client-first']:[])}}><CopilotChatMessageView messages={[{id:'client-first',role:'user',content:'hello'}]} isRunning={false} userMessage={V2UserMessage}/></UserMessageAttachmentsCtx.Provider></CopilotChatConfigurationProvider></CopilotKit>;}
beforeEach(()=>{
 paths=[];window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY,'synthetic-token');
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
  const path=new URL(String(input),'http://localhost').pathname;paths.push(path);
  return path.endsWith('/extraction')?json({claims:[],status:'empty'}):json({agents:{default:{name:'default',description:'test'}}});
 }));
});
afterEach(()=>{vi.unstubAllGlobals();window.localStorage.clear();});
it.each(['','   '])('waits for a real thread ID before extraction (%j), then queries the ready thread',async(threadId)=>{
 const v=render(view(threadId));await screen.findByTestId('chat-user-message-text');
 await new Promise(resolve=>setTimeout(resolve,30));
 expect(paths.filter(path=>path.endsWith('/extraction'))).toEqual([]);
 v.rerender(view('thread-ready'));
 await waitFor(()=>expect(paths.filter(path=>path.endsWith('/extraction'))).toEqual(['/knowledge-graph/threads/thread-ready/messages/client-first/extraction']));
});
it('does not query extraction for a draft or hydrated message never sent this session',async()=>{
 render(view('existing-thread',false));await screen.findByTestId('chat-user-message-text');
 await new Promise(resolve=>setTimeout(resolve,30));expect(paths.filter(path=>path.endsWith('/extraction'))).toEqual([]);
});
it.each([401,403,404])('retains refusal %i for an existing thread without treating it as empty success',async(status)=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json({reasonCode:'KG_THREAD_NOT_FOUND'},status)));
 render(<ExtractionFeedbackChip threadId='existing-attachment-thread' messageId='client-first'/>);
 await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));await new Promise(resolve=>setTimeout(resolve,30));
 expect(screen.queryByTestId('kg-extraction-empty')).not.toBeInTheDocument();expect(fetch).toHaveBeenCalledTimes(1);
});
it('ignores an old thread response and aborts its request when thread scope changes',async()=>{
 let resolveOld!:(value:Response)=>void;let oldSignal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).includes('/old-thread/')){oldSignal=init?.signal??undefined;return new Promise<Response>(resolve=>{resolveOld=resolve;});}
  return Promise.resolve(json({claims:[],status:'empty'}));
 }));
 const v=render(<ExtractionFeedbackChip threadId='old-thread' messageId='same-client'/>);
 await waitFor(()=>expect(resolveOld).toBeDefined());v.rerender(<ExtractionFeedbackChip threadId='new-thread' messageId='same-client'/>);
 await screen.findByTestId('kg-extraction-empty');expect(oldSignal?.aborted).toBe(true);
 resolveOld(json({claims:[{claimId:'old-claim',statement:'old thread secret',kind:'fact',personalCopyClaimId:null}],status:'written'}));
 await new Promise(resolve=>setTimeout(resolve,30));
 expect(screen.queryByText(/old thread secret/)).not.toBeInTheDocument();expect(screen.getByTestId('kg-extraction-empty')).toBeInTheDocument();
});
