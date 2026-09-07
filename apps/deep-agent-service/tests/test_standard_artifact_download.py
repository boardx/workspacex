import asyncio,pytest
from types import SimpleNamespace
from deep_agent_service import standard_artifact_download as subject
def runtime():return SimpleNamespace(tool_call_id='call-1',config={'configurable':{'run_control_callback':{'base_url':'https://gateway.example','key':'secret','org_id':'org','run_id':'run/1','attempt_id':'run/1:0','lease_epoch':1}}})
def test_tool_contract_and_refusal(monkeypatch):
 tool=subject.artifact_download_tool();assert tool.name=='wx_artifact_download';assert 'userId' not in tool.args_schema['properties']
 monkeypatch.setenv('HTTP_PROXY','http://untrusted.invalid')
 with pytest.raises(subject.StandardArtifactDownloadError):asyncio.run(subject._invoke({'artifactId':'a','versionId':'v','purpose':'download'},runtime()))
