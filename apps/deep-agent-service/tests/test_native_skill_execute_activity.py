"""Only actual, complete pinned instruction bytes may prove a narrow cat read."""
import base64
import shlex
from types import SimpleNamespace
from deepagents.backends.protocol import ExecuteResponse
from deep_agent_service import native_skill_activity as activity
from native_sandbox_fixture import real_native_session, pinned_skill_package


def test_real_cat_emits_but_echo_and_failed_commands_do_not(monkeypatch):
    facts=[]
    monkeypatch.setattr(activity,'get_stream_writer',lambda:facts.append)
    with real_native_session() as (adapter,pins):
        reporter=activity.NativeSkillActivity(pins)
        body=base64.b64decode(pins[0]['package']['files'][0]['contentBase64']).decode()
        commands=['printf %s '+shlex.quote(body),'cat /skills/missing/SKILL.md','cat /skills/example/SKILL.md']
        for index,command in enumerate(commands):
            request=SimpleNamespace(tool_call={'id':f'actual-{index}','name':'execute','args':{'command':command}})
            reporter.wrap_tool_call(request,lambda _:adapter.execute(command))
            assert len(facts)==(1 if index==2 else 0)
        assert facts[0]['fact']['stage']=='body_read'
        assert facts[0]['fact']['readPath']=='/skills/example/SKILL.md'


def test_truncated_failed_and_wrong_stdout_cannot_prove_cat():
    pins=pinned_skill_package(); reporter=activity.NativeSkillActivity(pins); facts=[]
    body=base64.b64decode(pins[0]['package']['files'][0]['contentBase64']).decode()
    token=activity._READ_CONTEXT.set((reporter,'actual-call',facts.append))
    try:
        for result in [ExecuteResponse(output=body,exit_code=1),ExecuteResponse(output=body,exit_code=0,truncated=True),ExecuteResponse(output='fake',exit_code=0)]:
            activity.observe_skill_execute('cat /skills/example/SKILL.md',result)
        assert facts==[]
    finally:activity._READ_CONTEXT.reset(token)
