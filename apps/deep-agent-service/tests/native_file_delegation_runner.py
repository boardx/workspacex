"""Called by the real PG/HTTP integration fixture; never uses external models."""
import asyncio
import json
import sys
from langchain_core.messages import AIMessage, ToolMessage
from native_sandbox_fixture import real_native_session
from deep_agent_service.native_tool_authority import HttpNativeToolAuthority
from test_native_graph import ScriptedModel
from deep_agent_service.native_graph import create_native_graph

class ObservingModel(ScriptedModel):
    observed:list=[]
    def _generate(self,messages,stop=None,run_manager=None,**kwargs):
        self.observed.extend(m.content for m in messages if isinstance(m,ToolMessage))
        return super()._generate(messages,stop=stop,run_manager=run_manager,**kwargs)

def main():
    data=json.load(sys.stdin)
    path=data['manifest'][0]['path'];messages=[]
    for index in [1,2]:
        messages.extend([AIMessage(content='',tool_calls=[{'id':f'task-{index}','name':'task','args':{'description':'Analyze the explicitly delegated attachment','subagent_type':'files-readonly'}}]),AIMessage(content='',tool_calls=[{'id':f'actual-read-{index}','name':'read_file','args':{'file_path':path}}]),AIMessage(content=f'CHECKED_CHILD_{index}')])
    messages.append(AIMessage(content='done'))
    model=ObservingModel(messages=iter(messages))
    with real_native_session([],inputs=data['files']) as (adapter,pins):
        graph=create_native_graph(model,sandbox=adapter,pinned_skills=pins,inputs=data['manifest'],tool_authority=HttpNativeToolAuthority(),interrupt_on={})
        result=asyncio.run(graph.ainvoke({'messages':[{'role':'user','content':'Delegate two independent attachment analyses'}]},config=data['config']))
        task_results=[m for m in result['messages'] if getattr(m,'tool_call_id',None) in ['task-1','task-2']]
        assert len(task_results)==2
        assert any(data['expectedText'] in str(content) for content in model.observed)
        assert adapter.write(path,'overwrite').error
        print(json.dumps({'completedDelegations':len(task_results),'actualSourceObserved':True,'readonlyInput':True,'externalModelCalls':0}))

if __name__=='__main__':main()
