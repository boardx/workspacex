"""Real configured text model and production native graph; no model/tool stubs."""
import asyncio,json,os,sys
from pathlib import Path
from langchain_openai import ChatOpenAI
from deep_agent_service import native_factory
config=json.load(sys.stdin)
for key in ('DASHSCOPE_API_KEY','DASHSCOPE_BASE_URL','DASHSCOPE_MODEL'):
 if not os.environ.get(key):raise RuntimeError('missing '+key)
model=ChatOpenAI(model=os.environ['DASHSCOPE_MODEL'],api_key=os.environ['DASHSCOPE_API_KEY'],base_url=os.environ['DASHSCOPE_BASE_URL'],timeout=90,max_retries=0,extra_body={'enable_thinking':False})
native_factory._shared_runtime=lambda:(model,None,[])
async def main():
 state=None;stages=[]
 async with native_factory.native_graph_context(config) as graph:
  async for mode,event in graph.astream({'messages':[{'role':'user','content':'请根据附件中的真实会议转录，选择适合的技能，生成会议纪要 Markdown 文件并发布为 minutes.md。包括摘要、已确认决策、行动项、未决定建议、原句或时间定位。未知责任人与日期请明确未知；不要建任务或外发。生成文件后实际读回核验，再用产物工具发布。'}]},config={**config,'recursion_limit':200},stream_mode=['custom','values']):
   if mode=='custom' and event.get('type')=='skill_activity':stages.append(event['fact'])
   if mode=='values':
    state=event
    # Persist synthetic-scenario progress even when a later tool fails.
    evidence=Path(os.environ['WX_AUDIO_REAL_EVIDENCE']);evidence.mkdir(parents=True,exist_ok=True)
    partial={'calls':[{'name':c['name'],'args':c['args']} for m in event['messages'] for c in getattr(m,'tool_calls',[])],'skillActivity':stages}
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
  result=await graph.ainvoke({'messages':[{'role':'user','content':'只回答算术：2+2等于几？不要生成任何文件。'}]},config={**config,'recursion_limit':100})
  negative=[call['name'] for message in result['messages'] for call in getattr(message,'tool_calls',[])]
 print(json.dumps({'model':os.environ['DASHSCOPE_MODEL'],'calls':calls,'results':results,'skillActivity':stages,'negativeCalls':negative,'final':messages[-1].content},ensure_ascii=False))
asyncio.run(main())
