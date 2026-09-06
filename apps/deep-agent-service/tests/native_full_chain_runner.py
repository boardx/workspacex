"""Cross-runtime test process. Only model responses are scripted; no transport/authority stubs."""
import asyncio
import json
import sys
from langchain_core.messages import AIMessage
from test_native_graph import ScriptedModel
from deep_agent_service import native_factory

config=json.load(sys.stdin)
model=ScriptedModel(messages=iter([
 AIMessage(content='',tool_calls=[{'id':'read-skill','name':'read_file','args':{'file_path':'/skills/example/SKILL.md'}}]),
 AIMessage(content='',tool_calls=[{'id':'execute-report','name':'execute','args':{'command':'python3 /skills/example/scripts/report.py'}}]),
 AIMessage(content='',tool_calls=[{'id':'publish-report','name':'wx_artifact_publish','args':{'workspacePath':'/workspace/report.txt','title':'report.txt','mediaType':'text/plain','idempotencyKey':'report-v1'}}]),
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
 print(json.dumps({'skillStages':stages,'tools':tools,'final':messages[-1].content},ensure_ascii=False))
asyncio.run(run())
