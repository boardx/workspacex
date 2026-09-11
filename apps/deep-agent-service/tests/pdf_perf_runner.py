"""issue #3401 measurement instrument: real model + production native graph, per-node wall clock.

Emits one JSON report with a monotonic timeline so each model turn and each tool
execution can be attributed separately. No stubs: same ChatOpenAI/native_factory
composition as skill_batch_real_model_runner.py.
"""
import asyncio,json,os,sys,time
from langchain_openai import ChatOpenAI
from deep_agent_service import native_factory

payload=json.load(sys.stdin)
config=payload['config'];prompt=payload['prompt']
for key in ('DASHSCOPE_API_KEY','DASHSCOPE_BASE_URL','DASHSCOPE_MODEL'):
 if not os.environ.get(key):raise RuntimeError('missing '+key)
model=ChatOpenAI(model=os.environ['DASHSCOPE_MODEL'],api_key=os.environ['DASHSCOPE_API_KEY'],base_url=os.environ['DASHSCOPE_BASE_URL'],timeout=600,max_retries=0,extra_body={'enable_thinking':False})
native_factory._shared_runtime=lambda:(model,None,[])

def preview(text,limit=1200):
 text=text if isinstance(text,str) else json.dumps(text,ensure_ascii=False)
 return text if len(text)<=limit else text[:limit]+f'...[{len(text)} chars total]'

async def main():
 t0=time.monotonic();timeline=[];skill_activity=[]
 def mark(kind,**extra):timeline.append({'t':round(time.monotonic()-t0,3),'kind':kind,**extra})
 async with native_factory.native_graph_context(config) as graph:
  mark('graph_ready')
  async for mode,event in graph.astream({'messages':[{'role':'user','content':prompt}]},config=config,stream_mode=['custom','updates']):
   if mode=='custom' and event.get('type')=='skill_activity':
    skill_activity.append(event['fact']);mark('skill_activity',stage=event['fact'].get('stage'),skill=event['fact'].get('skillStableName'))
   if mode!='updates':continue
   for node,update in event.items():
    messages=(update or {}).get('messages') or []
    calls=[];results=[]
    for message in messages:
     for call in getattr(message,'tool_calls',[]) or []:
      args=call.get('args') or {}
      calls.append({'name':call['name'],'argChars':len(json.dumps(args,ensure_ascii=False)),'args':{k:preview(v,4000) for k,v in args.items()}})
     if getattr(message,'type',None)=='tool':
      results.append({'name':message.name,'status':getattr(message,'status',None),'contentChars':len(str(message.content)),'content':preview(message.content)})
    mark('node',node=node,toolCalls=calls,toolResults=results)
  mark('stream_end')
 report={'model':os.environ['DASHSCOPE_MODEL'],'prompt':prompt,'totalSeconds':round(time.monotonic()-t0,3),'timeline':timeline,'skillActivity':skill_activity}
 serialized=json.dumps(report,ensure_ascii=False)
 for key in ('DASHSCOPE_API_KEY','NATIVE_SESSION_SERVICE_KEY','DEEP_AGENT_SERVICE_INTERNAL_KEY'):
  if os.environ.get(key):serialized=serialized.replace(os.environ[key],'[redacted]')
 print(serialized)
asyncio.run(main())
