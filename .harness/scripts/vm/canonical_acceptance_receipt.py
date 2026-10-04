"""Legacy workspacex-cn layout only; new A-route uses candidate_canonical_acceptance.
Canonical checks create no agent runs. No sibling source fallback.
"""
import datetime,time
from writer_fence import require

def canonical_receipt(plan,now=time.time):
    # No arbitrary callback or supplied passed object; execute existing source.
    # Root FD loader supplies this exact byte-pinned compiled module.
    # Local tests must explicitly preload it; no sibling-path fallback.
    import compiled_maintenance_activation as module
    checks=module.canonical_checks(plan)
    require(checks=={'status':'passed','lockRetained':True,'passedStages':8},'ACTUAL_CANONICAL_RECEIPT')
    browser=module.json.loads(module.private(plan['browserPlan']['path'],plan['browserPlan']['sha256']))
    return dict(schemaVersion=1,kind='canonical-acceptance-completed',identity=plan['identity'],deploymentMarker=browser['deploymentMarker'],observedAt=datetime.datetime.fromtimestamp(now(),datetime.timezone.utc).isoformat().replace('+00:00','Z'),ownedAcceptanceRunIds=[],checks=checks)

def persist_canonical_receipt(plan,now=time.time):
    from acceptance_receipt_store import publish_receipt
    # Calls actual source first; no supplied status/result argument.
    return publish_receipt(plan['identity'],'canonical',canonical_receipt(plan,now))
