import asyncio
import hashlib
import pytest
from deepagents.backends.protocol import ReadResult
from langchain_core.messages import AIMessage, ToolMessage
from native_sandbox_fixture import FakeAuthority
from test_native_graph import ScriptedModel, sandbox
from deep_agent_service.native_file_delegation import ReadOnlyDelegatedInputs, file_delegation_subagent, HttpFileDelegationAuthority
from deep_agent_service.native_tool_authority import ToolAuthorityError
from deep_agent_service.native_graph import create_native_graph
PATH='/inputs/'+('a'*64)+'/data.txt'
MANIFEST=[{'attachmentId':'a1','path':PATH,'filename':'data.txt','mediaType':'text/plain','sizeBytes':6,'digest':hashlib.sha256(b'SOURCE').hexdigest()}]
class Reader:
    def __init__(self):self.calls=[]
    def read(self,path,offset=0,limit=2000):
        self.calls.append(path)
        return ReadResult(file_data={'content':'SOURCE','encoding':'utf-8'},start_line=1,end_line=1,total_lines=1)
    async def aread(self,*args):return self.read(*args)
class Denied(FakeAuthority):
    def check(self,call):raise ToolAuthorityError('revoked or parent cancelled')
    async def acheck(self,call):self.check(call)
def test_official_read_tool_only_and_exact_manifest_paths():
    reader=Reader()
    child=file_delegation_subagent(ScriptedModel(messages=iter([AIMessage(content='done')])),reader,MANIFEST,FakeAuthority(),FakeAuthority())['runnable']
    node=child.nodes['tools'];tools=getattr(getattr(node,'bound',node),'tools_by_name')
    assert set(tools)=={'read_file'}
    assert tools['read_file'].func.__module__=='deepagents.middleware.filesystem'
    assert not any('SkillsMiddleware' in name for name in child.nodes)
    backend=ReadOnlyDelegatedInputs(reader,MANIFEST)
    for path in ['/workspace/data.txt','/skills/example/SKILL.md','/inputs/'+('b'*64)+'/data.txt',PATH+'/../data.txt']:
        with pytest.raises(ToolAuthorityError):backend.read(path)
    assert reader.calls==[]
@pytest.mark.parametrize('asynchronous',[False,True])
@pytest.mark.parametrize('which',['parent','source'])
def test_revocation_or_parent_cancellation_prevents_actual_read(asynchronous,which):
    reader=Reader()
    model=ScriptedModel(messages=iter([AIMessage(content='',tool_calls=[{'id':'read-1','name':'read_file','args':{'file_path':PATH}}])]))
    child=file_delegation_subagent(model,reader,MANIFEST,Denied() if which=='parent' else FakeAuthority(),Denied() if which=='source' else FakeAuthority())['runnable']
    with pytest.raises(ToolAuthorityError):
        if asynchronous:asyncio.run(child.ainvoke({'messages':[{'role':'user','content':'read'}]}))
        else:child.invoke({'messages':[{'role':'user','content':'read'}]})
    assert reader.calls==[]
@pytest.mark.parametrize('asynchronous',[False,True])
def test_two_explicit_official_tasks_read_backend_values(asynchronous):
    class ObservingModel(ScriptedModel):
        observed:list=[]
        def _generate(self,messages,stop=None,run_manager=None,**kwargs):
            self.observed.extend(m.content for m in messages if isinstance(m,ToolMessage))
            return super()._generate(messages,stop=stop,run_manager=run_manager,**kwargs)
    messages=[]
    for index in [1,2]:
        messages.extend([AIMessage(content='',tool_calls=[{'id':f'task-{index}','name':'task','args':{'description':f'Analyze attachment {index}','subagent_type':'files-readonly'}}]),AIMessage(content='',tool_calls=[{'id':f'read-{index}','name':'read_file','args':{'file_path':PATH}}]),AIMessage(content=f'SOURCE_RESULT_{index}')])
    messages.append(AIMessage(content='done'))
    model=ObservingModel(messages=iter(messages));adapter=sandbox();reader=Reader()
    adapter.read=reader.read;adapter.aread=reader.aread
    graph=create_native_graph(model,sandbox=adapter,pinned_skills=[],inputs=MANIFEST,tool_authority=FakeAuthority(),file_authority=FakeAuthority(),interrupt_on={})
    value={'messages':[{'role':'user','content':'Analyze twice'}]}
    result=asyncio.run(graph.ainvoke(value)) if asynchronous else graph.invoke(value)
    tasks=[m for m in result['messages'] if getattr(m,'tool_call_id','') in ['task-1','task-2']]
    assert len(tasks)==2 and 'SOURCE_RESULT_1' in str(tasks[0].content) and 'SOURCE_RESULT_2' in str(tasks[1].content)
    assert reader.calls==[PATH,PATH]
    assert any('SOURCE' in str(content) for content in model.observed)
def test_missing_callback_or_unknown_path_never_calls_transport(monkeypatch):
    authority=HttpFileDelegationAuthority(MANIFEST)
    with pytest.raises(ToolAuthorityError):authority.check({'id':'x','name':'read_file','args':{'file_path':PATH}})
    import deep_agent_service.native_tool_authority as native
    monkeypatch.setattr(native,'get_config',lambda:{'configurable':{'run_control_callback':{'base_url':'http://localhost','key':'secret','org_id':'org','run_id':'run','attempt_id':'attempt','lease_epoch':1}}})
    with pytest.raises(ToolAuthorityError):authority._request({'id':'x','name':'read_file','args':{'file_path':'/workspace/secret'}})
    url,headers,body=authority._request({'id':'actual-call','name':'read_file','args':{'file_path':PATH}})
    assert url.endswith('/internal/agent-runs/run/delegation/files/check') and body['toolCallId']=='actual-call' and body['file']==MANIFEST[0]


@pytest.mark.parametrize('asynchronous',[False,True])
def test_real_readonly_sandbox_attachment_delegation(asynchronous):
    import base64
    from native_sandbox_fixture import real_native_session
    with real_native_session([],inputs=[{'path':PATH,'contentBase64':base64.b64encode(b'SOURCE').decode()}]) as (adapter,pins):
        model=ScriptedModel(messages=iter([
            AIMessage(content='',tool_calls=[{'id':'real-read','name':'read_file','args':{'file_path':PATH}}]),
            AIMessage(content='read complete'),
        ]))
        child=file_delegation_subagent(model,adapter,MANIFEST,FakeAuthority(),FakeAuthority())['runnable']
        value={'messages':[{'role':'user','content':'Read the delegated attachment'}]}
        result=asyncio.run(child.ainvoke(value)) if asynchronous else child.invoke(value)
        read=next(m for m in result['messages'] if getattr(m,'tool_call_id',None)=='real-read')
        assert 'SOURCE' in str(read.content)
        assert adapter.write(PATH,'overwrite').error
        with pytest.raises(ToolAuthorityError):ReadOnlyDelegatedInputs(adapter,MANIFEST).read('/workspace/secret.txt')
