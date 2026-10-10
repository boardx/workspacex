"""Explicit consumption of independently admitted historical-byte revalidation.

A proof hash is a trust anchor ONLY when supplied by a protected approval, not
when computed from arbitrary caller input. No dynamic production authority here.
"""
from datetime import datetime, timezone
import copy
import cn_image_archive as a
import cn_image_candidate as c

REPO = 'boardx/workspacex'
WORKFLOW = '.github/workflows/build-cn-image-candidates.yml'
FILES = frozenset(('revalidate-cn-image-candidates.py','cn_candidate_github.py','cn_candidate_revalidation.py','cn_image_candidate.py',
                   'cn_image_archive.py','hosted-release.py','canonical_control.py'))


def validate_policy(p):
    fields={'kind','schemaVersion','audience','purpose','verificationId','repositoryId','runId','runAttempt','controlRevision',
            'producerWorkflowSha256','candidatePlanRawSha256','candidateSetRawSha256','artifactIds',
            'verifierRevision','verifierFiles','ghExecutable','ghSha256','issuedAt','expiresAt'}
    a.require(type(p) is dict and set(p)==fields and p['kind']=='candidate-revalidation-policy-v1'
              and type(p['schemaVersion']) is int and p['schemaVersion']==1,'REVALIDATION_POLICY_FIELDS')
    for k in ('repositoryId','runId','runAttempt'):
        a.require(type(p[k]) is int and p[k]>0,'REVALIDATION_PROVIDER_ID')
    for k in ('controlRevision','verifierRevision'):a.require(a.hex_string(p[k],40),'REVALIDATION_POLICY_REVISION')
    for k in ('producerWorkflowSha256','candidatePlanRawSha256','candidateSetRawSha256','ghSha256'):
        a.require(a.hex_string(p[k],64),'REVALIDATION_POLICY_HASH')
    a.require(type(p['artifactIds']) is dict and set(p['artifactIds'])=={'plan','set',*a.REPOSITORIES}
              and all(type(v) is int and v>0 for v in p['artifactIds'].values())
              and len(set(p['artifactIds'].values()))==7,'REVALIDATION_ARTIFACT_IDS')
    a.require(type(p['verifierFiles']) is dict and set(p['verifierFiles'])==FILES
              and all(a.hex_string(v,64) for v in p['verifierFiles'].values()),'REVALIDATION_VERIFIER_CLOSURE')
    a.require(isinstance(p['verificationId'],str) and a.re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',p['verificationId']),
              'REVALIDATION_VERIFICATION_ID')
    a.require(p['audience']=='i-uf6ga92ewloganobbln6' and p['purpose']=='candidate-transfer-publication', 'REVALIDATION_POLICY_SCOPE')
    fresh_policy(p)
    return p


def fresh_policy(p):
    now=datetime.now(timezone.utc);start=a.timestamp(p['issuedAt']);end=a.timestamp(p['expiresAt'])
    a.require(start<=now<end and 0<(end-start).total_seconds()<=3600,'REVALIDATION_POLICY_EXPIRED')


FIELDS = {'kind','schemaVersion','audience','purpose','verificationId','policyRawSha256','verifierRevision',
          'verifierFiles','verifiedStartedAt','verifiedAt','expiresAt','originalExpiresAt',
          'candidatePlanRawSha256','candidateSetRawSha256','candidateIdentity','sourceRevision',
          'controlRevision','attemptId','images','fragmentSha256','github','releaseReady','productionReady'}


def admit(raw, expected_proof_sha, expected_policy_sha, policy_raw):
    a.require(type(raw) is bytes and len(raw) <= 256*1024 and a.sha(raw) == expected_proof_sha,
              'REVALIDATION_RAW_HASH')
    a.require(type(policy_raw) is bytes and len(policy_raw)<=256*1024 and a.sha(policy_raw)==expected_policy_sha, 'REVALIDATION_POLICY_RAW_HASH')
    policy = validate_policy(a.decode(policy_raw))
    value = a.decode(raw)
    a.require(type(value) is dict and set(value) == FIELDS and value['kind'] == 'candidate-revalidation-v1'
              and type(value['schemaVersion']) is int and value['schemaVersion'] == 1,
              'REVALIDATION_FIELDS')
    a.require(a.hex_string(expected_policy_sha,64) and value['policyRawSha256'] == expected_policy_sha,
              'REVALIDATION_POLICY_BINDING')
    a.require(isinstance(value['verificationId'],str) and a.re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',value['verificationId'])
              and a.hex_string(value['verifierRevision'],40), 'REVALIDATION_IDENTITY')
    a.require(value['releaseReady'] is False and value['productionReady'] is False, 'REVALIDATION_NON_AUTHORIZING')
    for key in ('candidatePlanRawSha256','candidateSetRawSha256','candidateIdentity'):
        a.require(a.hex_string(value[key],64), 'REVALIDATION_HASH')
    for key in ('sourceRevision','controlRevision'):
        a.require(a.hex_string(value[key],40), 'REVALIDATION_SOURCE')
    a.require(type(value['fragmentSha256']) is dict and set(value['fragmentSha256']) == set(a.REPOSITORIES)
              and all(a.hex_string(v,64) for v in value['fragmentSha256'].values()),'REVALIDATION_FRAGMENTS')
    a.require(all(value[k]==policy[k] for k in ('verificationId','verifierRevision','verifierFiles','audience','purpose',
              'candidatePlanRawSha256','candidateSetRawSha256','controlRevision')), 'REVALIDATION_POLICY_CONTENT')
    gh=value['github']
    a.require(type(gh) is dict and set(gh)=={'repository','repositoryId','runId','runAttempt','workflow','producerWorkflowSha256','artifacts','runMetadataSha256','workflowMetadataSha256'}
              and gh['repository']==REPO and gh['workflow']==WORKFLOW
              and a.hex_string(gh['runMetadataSha256'],64) and a.hex_string(gh['workflowMetadataSha256'],64)
              and all(gh[k]==policy[k] for k in ('repositoryId','runId','runAttempt','producerWorkflowSha256')),
              'REVALIDATION_PROVENANCE')
    a.require(type(gh['artifacts']) is dict and set(gh['artifacts'])==set(policy['artifactIds']), 'REVALIDATION_ARTIFACT_SET')
    for name,artifact in gh['artifacts'].items():
        a.require(type(artifact) is dict and set(artifact)=={'artifactId','name','providerDigest','zipSha256','zipBytes','providerMetadataSha256'}
                  and artifact['artifactId']==policy['artifactIds'][name] and artifact['name']==artifact_name(name,policy)
                  and a.hex_string(artifact['providerMetadataSha256'],64) and a.hex_string(artifact['zipSha256'],64) and artifact['providerDigest']=='sha256:'+artifact['zipSha256']
                  and type(artifact['zipBytes']) is int and artifact['zipBytes']>0,'REVALIDATION_ARTIFACT_BINDING')
    a.require(a.timestamp(policy['issuedAt'])<=a.timestamp(value['verifiedStartedAt'])
              and a.timestamp(value['expiresAt'])<=a.timestamp(policy['expiresAt']), 'REVALIDATION_POLICY_TIME')
    cap = Revalidation(value, expected_proof_sha)
    cap.fresh()
    return cap


class Revalidation:
    """Trusted in-process capability, not a serialized bool or authorization."""
    def __init__(self, value, sha):
        self._value = copy.deepcopy(value); self.sha = sha

    @property
    def expires_at(self):
        return self._value['expiresAt']

    def fresh(self):
        value = self._value
        start, end, expiry = (a.timestamp(value[k]) for k in ('verifiedStartedAt','verifiedAt','expiresAt'))
        now = datetime.now(timezone.utc)
        a.require(start <= end <= now < expiry and 0 < (expiry-end).total_seconds() <= 3600
                  and (end-start).total_seconds() <= 3600, 'REVALIDATION_EXPIRED')

    def check(self, plan, candidate_raw, candidate_sha, plan_raw_sha):
        self.fresh()
        v = c.validate_historical_receipt(candidate_raw,plan,candidate_sha)
        expected = dict(candidatePlanRawSha256=plan_raw_sha,candidateSetRawSha256=candidate_sha,
                        candidateIdentity=c.identity(plan),originalExpiresAt=v['expiresAt'],images=v['images'],
                        **{k:plan[k] for k in ('sourceRevision','controlRevision','attemptId')})
        a.require(all(self._value[k] == val for k,val in expected.items())
                  and v['planRawSha256'] == plan_raw_sha and set(v['images']) == set(a.REPOSITORIES),
                  'REVALIDATION_CANDIDATE_BINDING')
        return v

    def verify_bundle(self, folder, plan, candidate_raw, candidate_sha, plan_raw_sha):
        self.check(plan,candidate_raw,candidate_sha,plan_raw_sha)
        result = c.verify_historical_bundle(folder,plan,candidate_raw,candidate_sha,plan_raw_sha)
        self.fresh()
        return result


def artifact_name(service,p):
    suffix=str(p['runId'])+'_'+str(p['runAttempt'])
    # Names are additional checks; immutable numeric IDs and provider hashes are the binding.
    suffix=suffix.replace('_','-')
    if service=='plan':return 'cn-candidate-plan-'+suffix
    if service=='set':return 'cn-image-candidate-set-'+suffix
    return 'cn-image-candidate-'+service+'-'+suffix
