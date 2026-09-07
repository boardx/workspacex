"""Real configured text model and production native graph; no model/tool stubs."""
import asyncio,json,os,sys
from pathlib import Path
from langchain_openai import ChatOpenAI
from deep_agent_service import native_factory
config=json.load(sys.stdin)
prompt=config.pop('livePrompt')
for key in ('DASHSCOPE_API_KEY','DASHSCOPE_BASE_URL','DASHSCOPE_MODEL'):
 if not os.environ.get(key):raise RuntimeError('missing '+key)
model=ChatOpenAI(model=os.environ['DASHSCOPE_MODEL'],api_key=os.environ['DASHSCOPE_API_KEY'],base_url=os.environ['DASHSCOPE_BASE_URL'],timeout=90,max_retries=0,extra_body={'enable_thinking':False})
native_factory._shared_runtime=lambda:(model,None,[])
async def main():
 state=None;stages=[];node_updates=[]
 async with native_factory.native_graph_context(config) as graph:
  async for mode,event in graph.astream({'messages':[{'role':'user','content':prompt}]},config=config,stream_mode=['custom','values','updates']):
   if mode=='updates':node_updates.append(list(event.keys()))
   if mode=='custom' and event.get('type')=='skill_activity':stages.append(event['fact'])
   if mode=='values':
    state=event
    # Persist synthetic-scenario progress even when a later tool fails.
    evidence=Path(os.environ['WX_AUDIO_REAL_EVIDENCE']);evidence.mkdir(parents=True,exist_ok=True)
    partial={'calls':[{'name':c['name'],'args':c['args']} for m in event['messages'] for c in getattr(m,'tool_calls',[])],'skillActivity':stages,'nodeUpdates':node_updates[-250:],'results':[{'toolCallId':m.tool_call_id,'name':m.name,'content':m.content,'status':getattr(m,'status',None)} for m in event['messages'] if m.type=='tool'],'lastMessage':{'type':event['messages'][-1].type,'content':event['messages'][-1].content},'stateKeys':list(event.keys())}
    serialized=json.dumps(partial,ensure_ascii=False)
    for key in ('DASHSCOPE_API_KEY','NATIVE_SESSION_SERVICE_KEY','DEEP_AGENT_SERVICE_INTERNAL_KEY'):
     if os.environ.get(key):serialized=serialized.replace(os.environ[key],'[redacted]')
    (evidence/'partial-model-trace.json').write_text(serialized)
 messages=state['messages'];calls=[];results=[]
 for message in messages:
  for call in getattr(message,'tool_calls',[]):calls.append({'id':call['id'],'name':call['name'],'args':call['args']})
  if message.type=='tool':results.append({'toolCallId':message.tool_call_id,'name':message.name,'content':message.content,'status':getattr(message,'status',None)})
 negative=[]
 async with native_factory.native_graph_context(config) as graph:
  result=await graph.ainvoke({'messages':[{'role':'user','content':'只回答算术：2+2等于几？不要生成任何文件。'}]},config=config)
  negative=[call['name'] for message in result['messages'] for call in getattr(message,'tool_calls',[])]
 print(json.dumps({'model':os.environ['DASHSCOPE_MODEL'],'calls':calls,'results':results,'skillActivity':stages,'negativeCalls':negative,'final':messages[-1].content},ensure_ascii=False))
asyncio.run(main())
