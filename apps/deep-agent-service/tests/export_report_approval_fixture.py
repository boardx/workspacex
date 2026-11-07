import asyncio,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from test_native_graph import model,sandbox
from test_self_hosted_runtime import MemoryLedger
from deep_agent_service.native_graph import create_native_graph
from deep_agent_service.native_tool_authority import HttpNativeToolAuthority
from deep_agent_service.self_hosted_runtime import Runtime,snapshot_projection,graph_config
import httpx
class NeedApproval:
    def check(self,call):return HttpNativeToolAuthority._validate(httpx.Response(200,json={'allowed':False,'reason':'approval_required'}))
    async def acheck(self,call):return self.check(call)
async def generate_fixture(output: Path):
    graph=create_native_graph(model(AIMessage(content='',tool_calls=[{'id':'render-report-1','name':'execute','args':{'command':'cd /workspace && node gen.js'}}])),sandbox=sandbox(),pinned_skills=[],tool_authority=NeedApproval(),interrupt_on={},checkpointer=InMemorySaver())
    ledger=MemoryLedger();runtime=Runtime(ledger,lambda _a,_c:graph)
    thread='report-approval-thread';await ledger.create_thread(thread,'do_nothing')
    config={'configurable':{'disable_task_auto_classify':True}}
    run=await runtime.create_run(thread,{'input':{'messages':[{'role':'user','content':'convert the saved report'}]},'config':config,'stream_mode':['values','updates']})
    await runtime.tasks[run]
    state=snapshot_projection(await graph.aget_state(graph_config(thread,config)))
    assert ledger.runs[run]['status']=='interrupted'
    assert any(task['interrupts'] for task in state['tasks'])
    output.write_text(json.dumps({'run':ledger.runs[run],'state':state,'events':await ledger.events(run)}))
if __name__ == '__main__':
    asyncio.run(generate_fixture(Path(sys.argv[1])))
