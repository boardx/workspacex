"""Fixed source operations inside the existing retained maintenance process.

Private files carry data only. The dispatcher has no callback, SQL, command or
module registry. Qualification remains separate from capture and requires the
independently approved source policy. Import never opens connections.
"""
import copy,hashlib,json,pathlib,re
from writer_fence import require

ACTIONS=('capture-current-epoch-draft','stage-epoch-external-evidence','finalize-epoch-input',
         'qualify-current-epoch','verify-qualified-current-epoch','held-candidate-readback','stage-candidate-and-seal',
         'canonical-candidate-acceptance','browser-candidate-acceptance',
         'read-public-candidate-identity','observe-opened-candidate')
PUBLIC_ACTIONS=('canonical-candidate-acceptance','browser-candidate-acceptance','read-public-candidate-identity','observe-opened-candidate')
REPEATABLE=('read-public-candidate-identity','observe-opened-candidate')
HASH=re.compile(r'^[a-f0-9]{64}$')

class MaintenanceSourceOperations:
 def __init__(self,host,adapter,journal,read=None):
  from host_transport import private
  self.host,self.adapter,self.journal=host,adapter,journal
  self.read=read or private;self.capture=None;self.draft=None;self.staged=None;self.qualified=None;self.qualification_input=None;self.candidate=None
  self.finished={};self.failed=False
  self.profile_raw=self.read('/etc/workspacex-cn/trusted-tool-binding.json')
  self.profile=json.loads(self.profile_raw);entry=self.profile.get('maintenanceSourceOperations')
  require(type(entry) is dict and set(entry)=={'schemaVersion','sourcePath','sha256','inputs'} and
          entry['schemaVersion']==1 and entry['sourcePath']=='.harness/scripts/vm/maintenance_source_operations.py',
          'SOURCE_OPERATIONS_CAPABILITY')
  require(self.profile['toolRevision']==host.plan['toolRevision'] and
          entry['sha256']==hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest() and
          self.profile['filesSha256'].get(entry['sourcePath'])==entry['sha256'],'SOURCE_OPERATIONS_SOURCE_PIN')
  require(type(entry['inputs']) is dict and set(entry['inputs'])<=set(ACTIONS),'SOURCE_OPERATIONS_INPUT_CLOSURE')
  self.inputs=copy.deepcopy(entry['inputs'])
  self.source_authority=self._source_authority(self.profile)
  self._validate_refs(self.inputs)
 def _source_authority(self,profile):
  entry=profile['maintenanceSourceOperations']
  return {k:copy.deepcopy(profile.get(k)) for k in ('toolRevision','filesSha256','installedFilesSha256')}|{'operationSource':{k:entry[k] for k in ('schemaVersion','sourcePath','sha256')}}
 def _validate_refs(self,inputs):
  require(type(inputs) is dict and set(inputs)<=set(ACTIONS),'SOURCE_OPERATIONS_INPUT_CLOSURE')
  for action,ref in inputs.items():
   expected='/etc/workspacex-cn/maintenance-source-inputs/'+self.host.plan['identity']['sourceRevision']+'/'+self.host.plan['identity']['attemptId']+'/'+action+'.json'
   require(type(ref) is dict and set(ref)=={'path','sha256'} and ref['path']==expected and
           type(ref['sha256']) is str and HASH.fullmatch(ref['sha256']),'SOURCE_OPERATIONS_FIXED_INPUT')
 def _input(self,action,identity,reference):
  require(not self.failed and action in ACTIONS and identity==self.host.plan['identity'],'SOURCE_OPERATIONS_REQUEST_BINDING')
  self.host.require_lock()
  # Evidence hashes become known after capture. Root may approve a late data
  # capability between operations; the executable source closure cannot change.
  raw=self.read('/etc/workspacex-cn/trusted-tool-binding.json');profile=json.loads(raw)
  require(self._source_authority(profile)==self.source_authority,'SOURCE_OPERATIONS_PROFILE_DRIFT')
  entry=profile['maintenanceSourceOperations'];require(set(entry)=={'schemaVersion','sourcePath','sha256','inputs'},'SOURCE_OPERATIONS_CAPABILITY')
  self._validate_refs(entry['inputs']);require(reference==entry['inputs'].get(action),'SOURCE_OPERATIONS_REQUEST_BINDING')
  self.profile_raw,self.profile,self.inputs=raw,profile,copy.deepcopy(entry['inputs'])
  raw=self.read(reference['path']);require(hashlib.sha256(raw).hexdigest()==reference['sha256'],'SOURCE_OPERATIONS_INPUT_HASH')
  value=json.loads(raw)
  require(type(value) is dict and set(value)=={'schemaVersion','identity','toolRevision','data'} and value['schemaVersion']==1 and
          value['identity']==identity and value['toolRevision']==self.host.plan['toolRevision'] and type(value['data']) is dict,
          'SOURCE_OPERATIONS_INPUT_SCHEMA')
  return value['data']
 def _blocked(self):self.adapter.verifyWritesBlocked(self.host.plan['identity'])
 def dispatch(self,action,identity,reference,candidate_actor=None):
  data=self._input(action,identity,reference)
  require(action in REPEATABLE or action not in self.finished,'SOURCE_OPERATIONS_ALREADY_EXECUTED')
  try:
   if action not in PUBLIC_ACTIONS:self._blocked()
   if action=='capture-current-epoch-draft':
    from retained_epoch_capture import CaptureRetainedBackupHost,RetainedEpochCapture
    require(set(data)=={'backupHost','binding','outputRoot'} and data['binding']['identity']==identity and
            data['binding']['toolRevision']==self.host.plan['toolRevision'] and data['binding']['host']==self.host.plan['host'] and
            data['binding']['holdGeneration']==self.host.plan['holdGeneration'],'SOURCE_CAPTURE_BINDING')
    root='/etc/workspacex-cn/maintenance-evidence/'+identity['sourceRevision']+'/'+identity['attemptId']
    require(data['outputRoot']==root,'SOURCE_CAPTURE_OUTPUT_ROOT')
    backup=CaptureRetainedBackupHost(data['backupHost'],self.adapter)
    self.capture=RetainedEpochCapture(backup,self.adapter,data['binding'],root,self.journal)
    import current_epoch_qualification as q
    from parent_source_invocation_receipt import record_production
    capability=self.profile.get('parentCaptureInvocation')
    q.exact(capability,('schemaVersion','producerId','executablePins'),'SOURCE_PARENT_CAPTURE_CAPABILITY')
    require(capability['schemaVersion']==1,'SOURCE_PARENT_CAPTURE_VERSION')
    pins={}
    for name in (*q.SOURCES,'parent_source_invocation_receipt.py','retained_epoch_capture.py'):
     source_path='.harness/scripts/vm/'+name;sha=self.profile['filesSha256'].get(source_path)
     require(type(sha) is str and HASH.fullmatch(sha),'SOURCE_PARENT_CAPTURE_CODE_PIN')
     pins[source_path]=dict(path='/usr/local/lib/workspacex-cn/'+name,sha256=sha)
    authority=q.QualificationCodeAuthority(pins,capability['executablePins'])
    protected=q.recovery.ProtectedArtifacts(self.capture.root)
    invocation_draft=record_production(self.capture,authority,protected,capability['producerId'],[])
    protected.finish();self.draft=self.capture.draft
    refs={kind:self.capture.save('invocation-'+kind.replace(':','-'),receipt) for kind,receipt in invocation_draft['invocations'].items()}
    value={'draft':self.draft,'invocationDraft':self.capture.save('parent-invocation-draft',invocation_draft),
           'invocations':refs,'qualified':False,'sourcePolicyApproved':False}
   elif action=='stage-epoch-external-evidence':
    require(self.capture is not None and self.draft is not None and set(data)=={'external'},'SOURCE_EPOCH_STAGE_ORDER')
    from current_epoch_qualification import recovery
    reader=recovery.ProtectedArtifacts(self.capture.root)
    self.staged=self.capture.stage_external_evidence(self.draft,data['external'],reader);reader.finish()
    value={'staged':self.staged,'qualified':False}
   elif action=='finalize-epoch-input':
    require(self.capture is not None and self.staged is not None and set(data)=={'sourcePolicy'},'SOURCE_EPOCH_FINALIZE_ORDER')
    from current_epoch_qualification import recovery
    reader=recovery.ProtectedArtifacts(self.capture.root)
    value={'input':self.capture.finalize(self.staged,reader,data['sourcePolicy']),'qualified':False};reader.finish()
   elif action in ('qualify-current-epoch','verify-qualified-current-epoch'):
    import current_epoch_qualification as q
    require(self.capture is not None and 'finalize-epoch-input' in self.finished and not data,'SOURCE_EPOCH_QUALIFY_ORDER')
    entry=self.profile.get('currentEpochQualification');q.exact(entry,('schemaVersion','sourcePath','sha256','input','sourcePolicy','executablePins'),'SOURCE_EPOCH_CAPABILITY')
    require(entry['schemaVersion']==2 and entry['sourcePath']=='.harness/scripts/vm/current_epoch_qualification.py' and
            entry['sha256']==hashlib.sha256(pathlib.Path(q.__file__).read_bytes()).hexdigest() and
            self.profile['filesSha256'].get(entry['sourcePath'])==entry['sha256'],'SOURCE_EPOCH_QUALIFIER_PIN')
    require(entry['input']==self.finished['finalize-epoch-input']['input'],'SOURCE_EPOCH_FINAL_INPUT_PIN')
    reader=q.recovery.ProtectedArtifacts(self.capture.root);p=reader.json(entry['input']);policy=reader.json(entry['sourcePolicy'])
    require(p['binding']==self.capture.b and p['outputRoot']==str(self.capture.root/'qualified-current-epoch'),'SOURCE_EPOCH_QUALIFICATION_BINDING')
    pins={}
    for source,ref in policy['sources'].items():
     expected='/usr/local/lib/workspacex-cn/'+source.removeprefix('.harness/scripts/vm/')
     require(source.startswith('.harness/scripts/vm/') and ref['path']==expected and ref['sha256']==self.profile['filesSha256'].get(source),'SOURCE_EPOCH_EXTERNAL_CODE_PIN')
     pins[source]={'path':expected,'sha256':ref['sha256']}
    authority=q.QualificationCodeAuthority(pins,entry['executablePins'])
    if action=='verify-qualified-current-epoch':require(self.qualified is not None,'SOURCE_EPOCH_VERIFY_BEFORE_QUALIFICATION')
    consumer=q.verify_existing_qualification if action=='verify-qualified-current-epoch' else q.qualify
    result=consumer(p,reader,entry['sourcePolicy'],code_authority=authority);reader.finish()
    if self.qualified is not None:require(result==self.qualified,'SOURCE_EPOCH_QUALIFICATION_DRIFT')
    self.qualified=result;self.qualification_input=copy.deepcopy(p);value=self.qualified
   elif action=='held-candidate-readback':
    require(self.qualified is not None,'SOURCE_READBACK_BEFORE_QUALIFICATION')
    from candidate_stage_host import CandidateStageHost
    from candidate_stage_actions import held_readback
    value=held_readback(data,CandidateStageHost(self.host,self.journal))
   elif action=='stage-candidate-and-seal':
    require(self.qualified is not None and 'held-candidate-readback' in self.finished and set(data)=={'prepare','producer'},'SOURCE_CANDIDATE_STAGE_ORDER')
    from candidate_stage_host import CandidateStageHost
    from candidate_stage_actions import prepare
    from concretize_candidate_template import concretize_and_write
    from candidate_plan_producer import produce,write_candidate
    bound={k:copy.deepcopy(self.capture.b[k]) for k in ('identity','toolRevision','host','epoch','holdGeneration')}
    require(all(data['prepare'][k]==bound[k] for k in bound),'SOURCE_CANDIDATE_CAPTURE_BINDING')
    require(type(data['producer']) is dict and set(data['producer'])=={*bound,'refs'} and
            all(data['producer'][k]==bound[k] for k in bound),'SOURCE_CANDIDATE_PRODUCER_BINDING')
    source=CandidateStageHost(self.host,self.journal);prepare(data['prepare'],source)
    # Capture/runtime evidence uses the semantic epoch; the immutable candidate
    # stage and final candidate plan bind the qualified manifest byte hash.
    stage_bound=copy.deepcopy(bound);stage_bound['epoch']=self.qualified['epoch']['sha256']
    rows=source.inspect_stage(source.compose['name']);snapshot=source.persist_stage_snapshot(stage_bound,rows)
    template=concretize_and_write(bound,source,snapshot,stage_binding=stage_bound);late=source.publish_late_evidence(bound)
    inputs=copy.deepcopy(data['producer']);require(all(inputs[k]==bound[k] for k in bound),'SOURCE_CANDIDATE_PRODUCER_BINDING')
    inputs['refs'].update(template=template,epochManifest=self.qualified['epoch'],
                         epochInput=self.qualification_input['collectionInput'],epochCollection=self.qualification_input['collection'],**late)
    wrapper=produce(inputs,source)
    path='/etc/workspacex-cn/maintenance-candidate/'+identity['sourceRevision']+'/'+identity['attemptId']+'/candidate-plan.json'
    self.candidate=write_candidate(path,wrapper);value={'reference':self.candidate,'stageSnapshot':snapshot}
   else:
    require(self.candidate is not None and candidate_actor is not None and candidate_actor.reference==self.candidate,'SOURCE_CANONICAL_CANDIDATE_BINDING')
    if action=='canonical-candidate-acceptance':
     from candidate_canonical_acceptance import persist_candidate_canonical_receipt
     value={'receipt':persist_candidate_canonical_receipt(candidate_actor.transport,data)}
    elif action=='browser-candidate-acceptance':
     from candidate_browser_acceptance import persist_candidate_browser_receipt
     value={'receipt':persist_candidate_browser_receipt(candidate_actor.transport,data)}
    elif action=='read-public-candidate-identity':
     from opened_service_health import collect_service_health
     require(set(data)=={'deploymentMarker'},'SOURCE_PUBLIC_MARKER_INPUT')
     proof=collect_service_health(candidate_actor.transport,data['deploymentMarker'])
     value=dict(sourceRevision=identity['sourceRevision'],deploymentMarker=proof['deploymentMarker'],trustworthy=True)
    else:
     from opened_host_evidence import collect_opened_host_evidence
     require(set(data)=={'deploymentMarker'} and all(a in self.finished for a in
             ('canonical-candidate-acceptance','browser-candidate-acceptance')),'SOURCE_OPENED_ACCEPTANCE_ORDER')
     binding=dict(identity=identity,deploymentMarker=data['deploymentMarker'],
                  canonicalReceipt=self.finished['canonical-candidate-acceptance']['receipt'],
                  browserReceipt=self.finished['browser-candidate-acceptance']['receipt'])
     proof=collect_opened_host_evidence(candidate_actor.transport,binding)
     value=dict(identity=identity,deploymentMarker=proof['deploymentMarker'],holdPresent=False,**proof['queue'],
                failedOwnedRuns=sum(r['status']!='succeeded' for r in proof['ownedRuns']),
                unhealthyServices=sum(status!='healthy' for status in proof['services'].values()))
   self.host.require_lock()
   require(self.read('/etc/workspacex-cn/trusted-tool-binding.json')==self.profile_raw,'SOURCE_OPERATIONS_FINAL_PROFILE_DRIFT')
   if action not in PUBLIC_ACTIONS:self._blocked()
   self.finished[action]=copy.deepcopy(value)
   return dict(schemaVersion=1,kind='maintenance-source-operation',identity=identity,toolRevision=self.host.plan['toolRevision'],
               action=action,input=reference,value=value,ready=False,productionAvailabilityProven=False)
  except BaseException:
   self.failed=True
   raise
