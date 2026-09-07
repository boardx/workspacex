"""Cross-runtime test process. Only model responses are scripted; no transport/authority stubs."""
import asyncio
import json
import sys
import os
from langchain_core.messages import AIMessage
from test_native_graph import ScriptedModel
from deep_agent_service import native_factory

config=json.load(sys.stdin)
seen_input_prompt=False
expected_paths=json.loads(os.environ['WX_INPUT_PATHS'])
class InputAwareModel(ScriptedModel):
 def _generate(self,messages,*args,**kwargs):
  global seen_input_prompt
  system='\n'.join(str(m.content) for m in messages if m.type=='system')
  assert all(path in system for path in expected_paths), system
  seen_input_prompt=True
  return super()._generate(messages,*args,**kwargs)
model=InputAwareModel(messages=iter([
 AIMessage(content='',tool_calls=[{'id':'read-skill','name':'read_file','args':{'file_path':'/skills/example/SKILL.md'}}]),
 AIMessage(content='',tool_calls=[{'id':'execute-report','name':'execute','args':{'command':'python3 /skills/example/scripts/report.py'}}]),
 AIMessage(content='',tool_calls=[{'id':'publish-report','name':'wx_artifact_publish','args':{'workspacePath':'/workspace/report.txt','title':'report.txt','mediaType':'text/plain','idempotencyKey':'report-v1'}}]),
 AIMessage(content='',tool_calls=[{'id':'search-source','name':'web_search','args':{'query':'Evidence source 中文','limit':1}}]),
 AIMessage(content='',tool_calls=[{'id':'fetch-source','name':'fetch_url','args':{'url':os.environ['WX_WEB_TEST_URL']}}]),
 AIMessage(content='Report staged for writeback.')]))
native_factory._shared_runtime=lambda:(model,None,[])
async def run():
 stages=[];state=None
 async with native_factory.native_graph_context(config) as graph:
  async for mode,event in graph.astream({'messages':[{'role':'user','content':'Use the example skill to generate and publish the report.'}]},config=config,stream_mode=['custom','values']):
   if mode=='custom' and event.get('type')=='skill_activity':stages.append(event['fact']['stage'])
   if mode=='values':state=event
 messages=state['messages']
 tools=[m.name for m in messages if m.type=='tool']
 assert all(getattr(m,'status',None)!='error' for m in messages),str(messages)
 web_results={m.name:json.loads(m.content) for m in messages if m.type=='tool' and m.name in ('web_search','fetch_url')}
 linked=web_results['web_search']['results'][0]['sourceId']==web_results['fetch_url']['sourceId']
 assert 'actual extracted body text' in web_results['fetch_url']['text']
 inputs_verified=any(m.type=='tool' and m.name=='execute' and 'UPLOADED_INPUTS_VERIFIED' in str(m.content) for m in messages)
 assert inputs_verified and seen_input_prompt
 print(json.dumps({'inputsVerified':inputs_verified,'inputPromptVerified':seen_input_prompt,'webSourceLinked':linked,'skillStages':stages,'tools':tools,'final':messages[-1].content},ensure_ascii=False))
asyncio.run(run())
