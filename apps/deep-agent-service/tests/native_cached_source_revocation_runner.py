"""Private fixture protocol: production factory/HTTP/UDS, deterministic model only."""
import asyncio
import json
import sys
from langchain_core.messages import AIMessage, ToolMessage
from deep_agent_service import native_factory
from deep_agent_service.native_tool_authority import ToolAuthorityError
from test_native_graph import ScriptedModel


async def main():
    value=json.loads(sys.stdin.readline())
    path=value.pop('cachedPath')
    calls=lambda name,args,ident:AIMessage(content='',tool_calls=[{'name':name,'args':args,'id':ident}])
    read={'file_path':path}
    execute={'command':"cat '"+path+"'"}
    model=ScriptedModel(messages=iter([
        calls('read_file',read,'revoked-read'),calls('execute',execute,'revoked-execute'),
        calls('read_file',read,'restored-read'),AIMessage(content='done'),
        calls('execute',execute,'restored-execute'),AIMessage(content='done'),
    ]))
    native_factory._shared_runtime=lambda:(model,None,[])
    async with native_factory.native_graph_context(value) as graph:
        print('READY',flush=True)
        assert (await asyncio.to_thread(sys.stdin.readline)).strip()=='REVOKED'
        refused=0
        for _ in range(2):
            try:
                await graph.ainvoke({'messages':[{'role':'user','content':'Read the cached source.'}]},config=value)
            except ToolAuthorityError:
                refused+=1
        assert refused==2
        print('DENIED',flush=True)
        assert (await asyncio.to_thread(sys.stdin.readline)).strip()=='RESTORED'
        for ident in ['restored-read','restored-execute']:
            result=await graph.ainvoke({'messages':[{'role':'user','content':'Read the restored source.'}]},config=value)
            outputs=[message for message in result['messages'] if isinstance(message,ToolMessage) and message.tool_call_id==ident]
            assert len(outputs)==1 and '450' in str(outputs[0].content)
        print('RESTORED_READ_AND_EXECUTE_VERIFIED',flush=True)


asyncio.run(main())
