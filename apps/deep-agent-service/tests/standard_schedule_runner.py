import asyncio
import json
import sys
from datetime import datetime,timedelta,timezone
from uuid import uuid4
from langchain_core.messages import AIMessage
from langgraph.graph import StateGraph,MessagesState,START,END
from langgraph.prebuilt import ToolNode
from deep_agent_service.standard_schedule import standard_schedule_tools
config=json.load(sys.stdin)
graph=StateGraph(MessagesState);graph.add_node('tools',ToolNode(standard_schedule_tools(),handle_tool_errors=False));graph.add_edge(START,'tools');graph.add_edge('tools',END)
compiled=graph.compile()
def invoke(name,args,asynchronous=False):
    state={'messages':[AIMessage(content='',tool_calls=[{'id':str(uuid4()),'name':name,'args':args}])]}
    output=asyncio.run(compiled.ainvoke(state,config)) if asynchronous else compiled.invoke(state,config)
    return json.loads(output['messages'][-1].content)
created=invoke('wx_schedule_create',{'instruction':'Python scheduled instruction','timezone':'UTC','trigger':'once','scheduleSpec':{'at':(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat()},'idempotencyKey':str(uuid4())})
listed=invoke('wx_schedule_list',{},True)
assert any(item['scheduleId']==created['scheduleId'] for item in listed['schedules'])
cancelled=invoke('wx_schedule_cancel',{'scheduleId':created['scheduleId'],'expectedRevision':created['revision']},True)
assert cancelled=={'cancelled':True}
print(json.dumps({'created':created,'listed':True,'cancelled':cancelled}))
