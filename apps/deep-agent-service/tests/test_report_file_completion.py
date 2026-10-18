import asyncio
import json
from dataclasses import dataclass,replace
from types import SimpleNamespace
from uuid import uuid4
import pytest
from langchain_core.messages import AIMessage,HumanMessage,ToolMessage
from deep_agent_service.native_tool_authority import NativeToolAuthority,ReportOutputPublished,ToolAuthorityError
from deep_agent_service.tool_budget import ToolBudgetMiddleware
from deep_agent_service.harness import _current_turn_messages

JOB=str(uuid4())
RECEIPT={'publishId':str(uuid4()),'status':'staged','sha256':'a'*64,'sizeBytes':100,'completion':{'kind':'report-file','jobId':JOB}}

def messages(receipt=RECEIPT,status='success'):
 return [HumanMessage(content='convert',id='wsx-turn:run:user'),AIMessage(content='',tool_calls=[{'id':'publish','name':'wx_artifact_publish','args':{}}]),ToolMessage(content=json.dumps(receipt),name='wx_artifact_publish',tool_call_id='publish',status=status)]

@dataclass
class Request:
 tools:list
 state:dict
 tool_choice:object=None
 def override(self,**changes):return replace(self,**changes)

@pytest.mark.parametrize('receipt,status',[(RECEIPT,'success'),({k:v for k,v in RECEIPT.items() if k!='completion'},'success'),(RECEIPT,'error'),({**RECEIPT,'completion':{'kind':'report-file','jobId':'fake'}},'success')])
def test_only_real_current_turn_report_receipt_removes_mutating_tools(receipt,status):
 req=Request([{'name':'execute'},{'name':'read_file'},{'name':'wx_artifact_publish'}],{'messages':messages(receipt,status)},'execute')
 result=ToolBudgetMiddleware(excluded=frozenset(),scope_messages=_current_turn_messages)._pruned(req)
 if receipt==RECEIPT and status=='success':
  assert result.tools==[] and result.tool_choice=='none'
 else:assert result is req

def test_old_turn_and_model_text_are_not_completion_authority():
 for trail in [messages()+[HumanMessage(content='new edit',id='wsx-turn:next:user')],[HumanMessage(content=json.dumps(RECEIPT),id='wsx-turn:run:user')]]:
  req=Request([{'name':'execute'}],{'messages':trail})
  assert ToolBudgetMiddleware(excluded=frozenset(),scope_messages=_current_turn_messages)._pruned(req) is req

def test_report_completion_does_not_reenable_tools_excluded_by_the_caller():
 req=Request([{'name':'execute'},{'name':'read_file'}],{'messages':messages()})
 assert ToolBudgetMiddleware(excluded=frozenset({'read_file'}),scope_messages=_current_turn_messages)._pruned(req).tools==[]

@pytest.mark.anyio
async def test_same_batch_recheck_blocks_mutation_after_successful_stage_and_normal_final_remains_possible():
 published=False;effects=[];first=asyncio.Event()
 class Authority:
  def check(self,call):raise AssertionError('async only')
  async def acheck(self,call):
   if published and call['name'] not in ('read_file',):raise ReportOutputPublished('host refused mutation')
   return {'allowed':True,'reportFile':{'jobId':JOB}}
 mw=NativeToolAuthority(Authority())
 async def handler(req):
  nonlocal published
  if req.tool_call['name']=='wx_artifact_publish':
   first.set();await asyncio.sleep(0.01);published=True;effects.append('stage');return 'staged'
  effects.append('write');return 'unexpected'
 publish=SimpleNamespace(tool_call={'id':'p','name':'wx_artifact_publish','args':{}})
 mutate=SimpleNamespace(tool_call={'id':'w','name':'write_file','args':{}})
 stage=asyncio.create_task(mw.awrap_tool_call(publish,handler));await first.wait()
 blocked=asyncio.create_task(mw.awrap_tool_call(mutate,handler))
 assert await stage=='staged';result=await blocked
 assert isinstance(result,ToolMessage) and result.status=='error' and 'REPORT_OUTPUT_ALREADY_STAGED' in result.content
 assert effects==['stage']
 # A malformed model can still emit a hidden tool: dispatch checks, not prompt pruning, refuse it.
 again=await mw.awrap_tool_call(mutate,handler);assert again.status=='error' and effects==['stage']
 final=AIMessage(content='File generation completed; the host will publish it during writeback.')
 assert not final.tool_calls

@pytest.mark.anyio
async def test_failed_publish_ordinary_chat_and_cancel_are_not_report_success():
 class Authority:
  def check(self,call):return None
  async def acheck(self,call):return None
 mw=NativeToolAuthority(Authority());effects=[]
 async def handler(req):effects.append(req.tool_call['name']);return 'done'
 req=SimpleNamespace(tool_call={'id':'ordinary','name':'write_file','args':{}})
 assert await mw.awrap_tool_call(req,handler)=='done' and effects==['write_file']
 class Cancel(Authority):
  async def acheck(self,call):raise ToolAuthorityError('cancel_requested')
 with pytest.raises(ToolAuthorityError):await NativeToolAuthority(Cancel()).awrap_tool_call(req,handler)

@pytest.fixture
def anyio_backend():return "asyncio"

@pytest.mark.anyio
async def test_native_graph_reaches_final_and_grader_after_report_publication(monkeypatch):
 from test_native_graph import model,sandbox,ScriptedModel
 from deep_agent_service.native_graph import create_native_graph
 from deep_agent_service import native_artifact_publish
 from deep_agent_service.native_artifact_publish import artifact_publish_tool
 published=False;effects=[];grader_results=[]
 original_generate=ScriptedModel._generate
 def observe_generate(self,*args,**kwargs):
  result=original_generate(self,*args,**kwargs)
  if any(call.get('name')=='GraderResponse' for generation in result.generations for call in getattr(generation.message,'tool_calls',[])):
   grader_results.append(result)
  return result
 monkeypatch.setattr(ScriptedModel,'_generate',observe_generate)
 class Authority:
  def check(self,call):raise AssertionError('async graph expected')
  async def acheck(self,call):
   if published and call['name'] not in ('read_file','write_todos'):
    raise ReportOutputPublished('host refused mutation')
   return {'allowed':True,'reportFile':{'jobId':JOB}}
 async def stage(runtime,args):
  nonlocal published
  effects.append('stage');published=True;return RECEIPT
 monkeypatch.setattr(native_artifact_publish,'_stage',stage)
 args={'workspacePath':'/workspace/report.pdf','title':'report.pdf','mediaType':'application/pdf','idempotencyKey':'report-file:fixture'}
 graph=create_native_graph(model(
  AIMessage(content='',tool_calls=[{'id':'p','name':'wx_artifact_publish','args':args}]),
  # Even a model emitting a tool removed from its offered tool list cannot dispatch it.
  AIMessage(content='',tool_calls=[{'id':'late','name':'execute','args':{'command':'overwrite report'}}]),
  AIMessage(content='The report file is staged for normal writeback.')),
  sandbox=sandbox(),pinned_skills=[],tool_authority=Authority(),interrupt_on={},tools=[artifact_publish_tool()])
 result=await graph.ainvoke({'messages':[HumanMessage(content='convert',id='wsx-turn:run:user')]},{'recursion_limit':100})
 assert effects==['stage']
 assert any(isinstance(m,ToolMessage) and m.tool_call_id=='late' and m.status=='error' for m in result['messages'])
 assert isinstance(result['messages'][-1],AIMessage) and not result['messages'][-1].tool_calls
 assert result['messages'][-1].content=='The report file is staged for normal writeback.'
 assert grader_results, 'The ordinary rubric grader must actually execute after the final'


def test_successful_report_stage_requests_a_normal_final_without_read_or_todo_loop():
 req=Request([{'name':'read_file'},{'name':'write_todos'},{'name':'execute'}],{'messages':messages()},'auto')
 result=ToolBudgetMiddleware(excluded=frozenset(),scope_messages=_current_turn_messages)._pruned(req)
 assert result.tools==[] and result.tool_choice=='none'
 assert result.state is req.state  # No synthetic final or altered grader/agent state.

def test_final_only_request_is_serializable_by_the_existing_openai_adapter(monkeypatch):
 from deep_agent_service.model import build_chat_model
 monkeypatch.setenv('KERNEL_MODEL_BASE_URL','https://example.invalid/v1')
 monkeypatch.setenv('KERNEL_MODEL_API_KEY','fixture-not-secret')
 monkeypatch.setenv('KERNEL_DEEP_AGENT_MODEL_ID','fixture-model')
 req=Request([{'name':'read_file'},{'name':'write_todos'}],{'messages':messages()},'auto')
 final=ToolBudgetMiddleware(excluded=frozenset(),scope_messages=_current_turn_messages)._pruned(req)
 payload=build_chat_model()._get_request_payload([HumanMessage(content='finish')],tool_choice=final.tool_choice)
 assert payload['tool_choice']=='none' and not payload.get('tools')
