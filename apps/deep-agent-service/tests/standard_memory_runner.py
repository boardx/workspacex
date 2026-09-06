"""Real process/ToolNode entry used by the TypeScript HTTP + PostgreSQL evidence."""
import asyncio
import json
import sys
from langchain_core.messages import AIMessage
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode
from deep_agent_service.standard_memory import standard_memory_tools, setup_memory_store

request=json.load(sys.stdin)
if request.get('setup'):setup_memory_store()
builder=StateGraph(MessagesState)
builder.add_node('tools',ToolNode(standard_memory_tools(),handle_tool_errors=False))
builder.add_edge(START,'tools');builder.add_edge('tools',END)
graph=builder.compile()
state={'messages':[AIMessage(content='',tool_calls=[{'id':'real-process-tool-call','name':request['name'],'args':request['args']}])]}
result=asyncio.run(graph.ainvoke(state,request['config'])) if request.get('async') else graph.invoke(state,request['config'])
print(json.dumps(json.loads(result['messages'][-1].content)))
