"""Fixed maintenance candidate pointer CAS. Import performs no I/O or mutation.

The trusted root launcher preloads compiled_maintenance_activation from verified
FD bytes. Only its private/replace/invoke primitives are reused; legacy operations
and Compose up/activate are never invoked. Candidate writers remain held here.
"""
import copy
import hashlib
import json
import pathlib
import re
import secrets
from candidate_writer import APP, BASELINE
from writer_fence import require, digest
from fixed_probes import FixedProbes
from control_connection import verify_bound_transport
from candidate_completion_contract import validate_completed

PROFILE='/etc/workspacex-cn/trusted-tool-binding.json'
SOURCE='.harness/scripts/vm/candidate_pointer_adapter.py'
ACTIVATION_SOURCE='.harness/scripts/vm/cn-maintenance-activation.py'
FIXED='/etc/workspacex-cn/deployment.json'
NGINX='/etc/nginx/conf.d/workspacex-cn.conf'
SERVICES={'api','web','agent','sandbox','sandbox-sessions'}


def exact(value,keys,code):
    require(type(value) is dict and set(value)==set(keys),code)


def sha(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}',value) is not None


class CandidatePointerAdapter:
    def __init__(self,transport,binding):
        import compiled_maintenance_activation as source
        self.transport,self.source=transport,source
        self.binding=copy.deepcopy(binding)
        self.journal=transport.journal
        self.profile_raw=source.private(PROFILE)
        self.profile=json.loads(self.profile_raw)
        self._validate()

    def _validate(self):
        b=self.binding;p=self.transport.plan;s=self.source
        exact(b,('identity','toolRevision','host','holdGeneration','epoch','migrationCompletion',
                 'baselineConfig','candidateConfig','baselineNginx','candidateNginx','binaries'),
              'CANDIDATE_POINTER_BINDING_SCHEMA')
        require(b['identity']==p['identity'] and b['identity']['sourceRevision']==APP and
                b['identity']['baselineRevision']==BASELINE and b['host']==p['host'] and
                b['holdGeneration']==p['holdGeneration'] and b['epoch']==p['epoch'] and
                b['toolRevision']==self.transport.host.plan['toolRevision']==self.profile['toolRevision'] and
                self.journal.value['identity']==p['identity'],'CANDIDATE_POINTER_IDENTITY')
        require(sha(b['epoch']) and type(b['holdGeneration']) is str and
                re.fullmatch('[a-f0-9]{32}',b['holdGeneration']) is not None,'CANDIDATE_POINTER_EPOCH')
        descriptor=self.profile.get('candidatePointerPromotion')
        exact(descriptor,('schemaVersion','sourcePath','sha256','binding'),'CANDIDATE_POINTER_PROFILE')
        require(descriptor['schemaVersion']==1 and descriptor['sourcePath']==SOURCE and
                descriptor['binding']==b and descriptor['sha256']==hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
                and self.profile['filesSha256'].get(SOURCE)==descriptor['sha256'] and
                self.profile['filesSha256'].get(ACTIVATION_SOURCE)==hashlib.sha256(pathlib.Path(s.__file__).read_bytes()).hexdigest(),
                'CANDIDATE_POINTER_SOURCE_CLOSURE')
        require(s.FIXED==FIXED and s.NGINX==NGINX and all(callable(getattr(s,k,None)) for k in
                ('private','replace','invoke')),'CANDIDATE_POINTER_FIXED_PRIMITIVES')
        attempt=b['identity']['attemptId']
        require(type(attempt) is str and re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}',attempt),
                'CANDIDATE_POINTER_ATTEMPT')
        root=f'/etc/workspacex-cn/candidate-configs/{APP}/{attempt}'
        paths={'baselineConfig':root+'/baseline.json','candidateConfig':root+'/deployment.json',
               'baselineNginx':f'/var/lib/workspacex-cn/runtime/{APP}/baseline-nginx.conf',
               'candidateNginx':f'/var/lib/workspacex-cn/runtime/{APP}/nginx.conf',
               'migrationCompletion':f'/etc/workspacex-cn/migration-completion-inputs/{APP}/{attempt}.completed.json'}
        for name,path in paths.items():
            ref=b[name];exact(ref,('path','sha256'),'CANDIDATE_POINTER_REF')
            require(ref['path']==path and sha(ref['sha256']),'CANDIDATE_POINTER_REF_SCOPE')
        require(b['baselineConfig']['sha256']!=b['candidateConfig']['sha256'] and
                b['migrationCompletion']['sha256']==p['migrationCompletionSha256'],
                'CANDIDATE_POINTER_HASH_BINDING')
        emitter=self.profile.get('candidateComposeEmitter',{})
        configref=emitter.get('configRef')
        exact(configref,('path','sha256'),'CANDIDATE_POINTER_NATIVE_CONFIG_REF')
        require(type(configref['path']) is str and configref['path'].startswith('/etc/workspacex-cn/') and
                '..' not in pathlib.Path(configref['path']).parts and configref['sha256']==b['candidateConfig']['sha256'],
                'CANDIDATE_POINTER_NATIVE_CONFIG_BINDING')
        self.native_config_ref=copy.deepcopy(configref)
        exact(b['binaries'],('nginx','systemctl'),'CANDIDATE_POINTER_BINARY_SCOPE')
        for name,path in (('nginx','/usr/sbin/nginx'),('systemctl','/usr/bin/systemctl')):
            exact(b['binaries'][name],('path','sha256'),'CANDIDATE_POINTER_BINARY_SCHEMA')
            require(b['binaries'][name]['path']==path and sha(b['binaries'][name]['sha256']),
                    'CANDIDATE_POINTER_BINARY_BINDING')

    def _guard(self):
        t=self.transport;p=t.plan
        t.require_lock();t._guard(copy.deepcopy(p))
        require(self.source.private(PROFILE)==self.profile_raw,'CANDIDATE_POINTER_PROFILE_DRIFT')
        require(FixedProbes(t.host).admission()[0]==p['closedAdmission'],'CANDIDATE_POINTER_WRITES_OPEN')

    def _read(self,ref):
        raw=self.source.private(ref['path'],ref['sha256'])
        require(type(raw) is bytes and len(raw)<=1024*1024 and hashlib.sha256(raw).hexdigest()==ref['sha256'],
                'CANDIDATE_POINTER_REF_DRIFT')
        return raw

    def _runtime(self):
        t=self.transport;p=t.plan
        t.verify_staging(copy.deepcopy(p));writers=t._inventory(copy.deepcopy(p))
        require(all(writers[w['key']]['state'] in ('paused','stopped') for w in
                p['candidateWriters']+p['baselineWriters']),'CANDIDATE_POINTER_RUNTIME_NOT_HELD')
        live=t.docker_inventory();index={c['Id']:c for c in live}
        require(len(index)==len(live),'CANDIDATE_POINTER_RUNTIME_DUPLICATE')
        projects={};seen=set()
        for side in ('candidateWriters','baselineWriters'):
            projects[side]=set()
            for w in p[side]:
                b=w['binding'];c=index.get(b['containerId'])
                require(c is not None and c['Image']==b['imageId'] and digest(c['Config'])==b['configSha256'],
                        'CANDIDATE_POINTER_RUNTIME_SOURCE')
                labels=c['Config']['Labels']
                require(labels.get('com.docker.compose.service')==b['service'] and
                        labels.get('com.docker.compose.project.config_files')==b['composePath'] and
                        hashlib.sha256(t.private(b['composePath'])).hexdigest()==b['composeSha256'],
                        'CANDIDATE_POINTER_COMPOSE_SOURCE')
                projects[side].add(labels.get('com.docker.compose.project'))
                if side=='candidateWriters':
                    require(b['service'] not in seen and labels.get('org.opencontainers.image.revision')==APP,
                            'CANDIDATE_POINTER_CANDIDATE_SOURCE')
                    seen.add(b['service'])
        require(seen==SERVICES and all(len(v)==1 and None not in v for v in projects.values()) and
                projects['candidateWriters'].isdisjoint(projects['baselineWriters']),
                'CANDIDATE_POINTER_PROJECT_ALIAS')
        return writers

    def _completion(self):
        b=self.binding;p=self.transport.plan;ref=b['migrationCompletion'];j=self.journal.value
        require(j.get('migrationCompletionReceipt')==j.get('migrationCompletionIntent')==ref and
                any(e['state']=='migration-completion-durable' and e.get('receipt')==ref and
                    e.get('holdGeneration')==b['holdGeneration'] for e in j['events']),
                'CANDIDATE_POINTER_COMPLETION_NOT_DURABLE')
        raw=self._read(ref);completed=json.loads(raw)
        connection=self.transport.host.diagnostic_connections['workspacex']
        require(connection.binding==self.transport.host.plan['diagnosticSessions']['workspacex'],
                'CANDIDATE_POINTER_DIAGNOSTIC_BINDING')
        verify_bound_transport(self.transport.host.plan,'workspacex','diagnostic',connection.binding)
        actual=connection.query('migration-ledger')
        require(type(actual) is dict and type(actual.get('ledger')) is list and
                actual.get('rowCount')==len(actual['ledger']),'CANDIDATE_POINTER_DIAGNOSTIC_LEDGER')
        ledger=validate_completed(completed,p['identity'],actual['ledger'])
        require(ledger==p['migrationLedgerSha256'],'CANDIDATE_POINTER_LEDGER_DRIFT')
        proof=self.transport.verify_completed_migration(copy.deepcopy(p),secrets.token_hex(32))
        require(proof['identity']==b['identity'] and proof['epoch']==b['epoch'] and
                proof['holdGeneration']==b['holdGeneration'] and proof['completionSha256']==ref['sha256'] and
                proof['ledgerSha256']==ledger and self._read(ref)==raw,'CANDIDATE_POINTER_LIVE_COMPLETION')

    def promote_under_hold(self):
        b=self.binding;s=self.source;j=self.journal;bound=digest(b)
        self._guard();self._completion();runtime=self._runtime()
        refs={name:self._read(b[name]) for name in ('baselineConfig','candidateConfig','baselineNginx','candidateNginx')}
        require(self._read(self.native_config_ref)==refs['candidateConfig'],'CANDIDATE_POINTER_NATIVE_CONFIG_DRIFT')
        candidate=json.loads(refs['candidateConfig']);baseline=json.loads(refs['baselineConfig'])
        require(candidate.get('schemaVersion')==1 and candidate.get('environment',{}).get('profile')=='production' and
                candidate.get('provision',{}).get('release')=='2026.10.3-cn.1' and
                baseline.get('provision',{}).get('release')!=candidate['provision']['release'],
                'CANDIDATE_POINTER_CONFIG_RELEASE')
        require(not j.value.get('candidatePointerUnknown'),'CANDIDATE_POINTER_RECONCILIATION_REQUIRED')
        prior=j.value.get('candidatePointerPromotion')
        if prior is not None:
            require(any(e['state']=='candidate-pointer-promotion-readback' and e.get('proof')==prior
                        for e in j.value['events']),'CANDIDATE_POINTER_REPLAY_NOT_DURABLE')
            require(prior['bindingSha256']==bound and s.private(FIXED)==refs['candidateConfig'] and
                    s.private(NGINX)==refs['candidateNginx'],'CANDIDATE_POINTER_REPLAY_DRIFT')
            self._guard();return copy.deepcopy(prior)
        require(not j.value.get('candidatePointerIntents'),'CANDIDATE_POINTER_PENDING_INTENT')
        require(s.private(FIXED)==refs['baselineConfig'] and s.private(NGINX)==refs['baselineNginx'],
                'CANDIDATE_POINTER_BASELINE_CAS')
        attempted=False
        try:
            for name,target,old,new in (('config',FIXED,'baselineConfig','candidateConfig'),
                                        ('nginx',NGINX,'baselineNginx','candidateNginx')):
                self._guard();require(self._runtime()==runtime,'CANDIDATE_POINTER_RUNTIME_DRIFT')
                intent=dict(bindingSha256=bound,target=target,expectedSha256=b[old]['sha256'],desiredSha256=b[new]['sha256'])
                attempted=True;j.value.setdefault('candidatePointerIntents',{})[name]=intent
                j.record('candidate-pointer-intent',pointer=name,intent=copy.deepcopy(intent),holdGeneration=b['holdGeneration'])
                s.replace(target,b[old]['sha256'],refs[new])
                require(s.private(target)==refs[new],'CANDIDATE_POINTER_CAS_READBACK')
                j.record('candidate-pointer-cas-readback',pointer=name,sha256=b[new]['sha256'],holdGeneration=b['holdGeneration'])
            self._guard();s.invoke({'binaries':b['binaries']},'nginx',['-t'])
            self._guard();j.record('candidate-pointer-reload-intent',bindingSha256=bound,holdGeneration=b['holdGeneration'])
            s.invoke({'binaries':b['binaries']},'systemctl',['reload','nginx'])
            self._guard();require(self._runtime()==runtime,'CANDIDATE_POINTER_RUNTIME_DRIFT')
            require(s.private(FIXED)==refs['candidateConfig'] and s.private(NGINX)==refs['candidateNginx'] and
                    all(self._read(b[k])==v for k,v in refs.items()),'CANDIDATE_POINTER_FINAL_READBACK')
            proof=dict(kind='candidate-pointer-promoted-under-hold',identity=b['identity'],toolRevision=b['toolRevision'],
                       host=b['host'],holdGeneration=b['holdGeneration'],epoch=b['epoch'],bindingSha256=bound,
                       configSha256=b['candidateConfig']['sha256'],nginxSha256=b['candidateNginx']['sha256'],
                       completionSha256=b['migrationCompletion']['sha256'],writesHeld=True,lockRetained=True)
            j.value['candidatePointerPromotion']=proof
            j.record('candidate-pointer-promotion-readback',proof=copy.deepcopy(proof))
            return copy.deepcopy(proof)
        except BaseException:
            if attempted:
                j.value['candidatePointerUnknown']=dict(bindingSha256=bound,lockRetained=True,writesHeldUnproven=True)
                try:j.record('candidate-pointer-outcome-unknown',bindingSha256=bound,lockRetained=True)
                except BaseException:pass
            # No baseline pointer restoration, role resume, hold clearing or cleanup.
            raise RuntimeError('CANDIDATE_POINTER_OUTCOME_UNKNOWN_LOCK_RETAINED') from None
