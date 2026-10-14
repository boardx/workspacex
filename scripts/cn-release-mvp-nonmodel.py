#!/usr/bin/env python3
"""Fixed non-model HTTP journeys. Library only; trusted admission precedes login."""
import hashlib,importlib.util,json,re,time,urllib.request,urllib.error,urllib.parse

def need(ok,code):
 if not ok:raise ValueError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):raise ValueError('HTTP_REDIRECT_FORBIDDEN')
def http(origin,path,token=None,body=None,timeout=10):
 need(path.startswith('/')and not path.startswith('//'),'FIXED_HTTP_PATH')
 headers={'Accept':'application/json','Cache-Control':'no-store'}
 if token:headers['Authorization']='Bearer '+token
 raw=None if body is None else json.dumps(body).encode()
 if raw:headers['Content-Type']='application/json'
 request=urllib.request.Request(origin+path,data=raw,headers=headers)
 try:response=urllib.request.build_opener(NoRedirect).open(request,timeout=timeout)
 except urllib.error.HTTPError as error:response=error
 with response:
  data=response.read(65537);need(len(data)<=65536,'HTTP_RESPONSE_LIMIT')
  return response.status,json.loads(data)
def execute(identity,fixtures,credentials,origin,production_run_id,admit,*,request=http,clock=time.time):
 """admit is a pinned privileged runtime/writer adapter, never caller flags.

 Existing test accounts/resources only. Login writes sessions/audit. No model,
 resource creation, account creation, privilege changes or credentials output.
 """
 from pathlib import Path
 spec=importlib.util.spec_from_file_location('nonmodel_identity',Path(__file__).with_name('cn-release-mvp-chain.py'));chain=importlib.util.module_from_spec(spec);spec.loader.exec_module(chain);chain.identity(identity)
 need(type(production_run_id)is int and production_run_id>0,'PRODUCTION_RUN')
 need(callable(admit),'TRUSTED_RUNTIME_ADMISSION_REQUIRED')
 url=urllib.parse.urlsplit(origin);need(not url.username and not url.password and not url.query and not url.fragment and url.path in ('','/'),'ORIGIN')
 need(url.scheme=='https' or (url.scheme=='http'and url.hostname in ('127.0.0.1','localhost')),'HTTPS_REQUIRED')
 origin=origin.rstrip('/')
 roles=('primary','foreign','restricted');need(set(fixtures)==set(roles)|{'deploymentMarker'} and set(credentials)==set(roles),'FIXTURE_SCOPE')
 for role in roles:
  need(set(fixtures[role])=={'userId','orgId','projectId'},'FIXTURE_FIELDS')
  need(all(isinstance(v,str)and re.fullmatch('[a-zA-Z0-9_-]{1,128}',v)for v in fixtures[role].values()),'FIXTURE_ID')
  need(set(credentials[role])=={'email','password'},'CREDENTIAL_FIELDS')
 need(fixtures['primary']['orgId']==fixtures['restricted']['orgId']and fixtures['primary']['orgId']!=fixtures['foreign']['orgId'],'TENANT_FIXTURE_SCOPE')
 need(len({fixtures[r]['userId']for r in roles})==3 and len({fixtures[r]['projectId']for r in roles})==3,'DISTINCT_FIXTURES')
 observations=[]
 def observe(label,path,token=None,body=None):
  status,value=request(origin,path,token,body)
  # Never retain raw login/identity/project response or token-bearing hashes.
  observations.append({'probe':label,'status':status});return status,value
 admit(identity,origin) # Must reject stale runtime/writer authority before login.
 tokens={}
 for role in roles:
  admit(identity,origin) # Recheck the original writer/window boundary per login.
  status,value=observe('login-'+role,'/api/auth/login',body=credentials[role]);f=fixtures[role]
  # Membership list ordering does not attest the session's default org. Require
  # existing single-org fixtures, then prove context by their owned resource.
  need(status==200 and value.get('userId')==f['userId'] and value.get('orgs')==[f['orgId']],'LOGIN_IDENTITY')
  token=value.get('sessionToken');need(isinstance(token,str)and 0<len(token.encode())<=16384,'SESSION_TOKEN');tokens[role]=token
  status,value=observe('owner-'+role,'/api/projects/'+f['projectId']+'/overview',token)
  need(status==200 and value.get('projectId')==f['projectId'],'FIXTURE_OWNER_READBACK')
 for role in ('foreign','restricted'):
  status,value=observe('deny-'+role,'/api/projects/'+fixtures[role]['projectId']+'/overview',tokens['primary'])
  need(status==403 and value=={'reasonCode':'NO_PROJECT_ROLE'},'RESOURCE_DENIAL_UNPROVEN')
 status,_=observe('unauthenticated','/api/projects/'+fixtures['primary']['projectId']+'/overview');need(status==401,'AUTH_GUARD')
 status,health=observe('health','/api/healthz');need(status==200 and health.get('trustworthy')is True and health.get('rlsForced')is True and health.get('appRoleIsOwner')is False and health.get('deploymentMarker')==fixtures['deploymentMarker'],'KERNEL_HEALTH')
 status,marker=observe('deployment','/.well-known/workspacex-deployment');need(status==200 and marker.get('deploymentMarker')==fixtures['deploymentMarker'],'PUBLIC_DEPLOYMENT_BINDING')
 admit(identity,origin) # Fresh independent readback after all journeys.
 return {'kind':'cn-mvp-nonmodel-receipt-v1','identity':identity,'productionRunId':production_run_id,'futureV2Content':'NOT_APPLICABLE','checks':{k:'PASSED'for k in ('tenant_protection','login','permissions','fixed_api_behavior')},'modelQuality':'SKIPPED','fullBusinessAcceptance':False,'observedAtUnix':clock(),'observations':observations}
