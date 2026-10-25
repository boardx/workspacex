#!/usr/bin/env python3
"""Lossless, fixed-source DevApp migration review; never rewrites historical ledger."""
import hashlib
import importlib.util
from pathlib import Path

SOURCE = '7265bb89a9d4cc7bac9ca11ff638eb5a3c8a02d0'
BASELINE = 'd98613266de68a57c9b73b471fd547ffb81092dc'
PENDING = {
 '20261022110000_credit_consumption_settings.sql': '5a7446bda91a622a524908cbcd79458f4f0b8c227767171dd29e547f03b1992d',
 '20261022120000_credit_consumption.sql': '4b40e057ed9e497c59154fc32af695fc34b490063c28c68232ab87cdeb447e80',
 '20261022150000_credit_run_errors.sql': 'a7859f2d7ffc4ffaebb7df5a47dfbb6501537d94980ba0359d7f7dea0bbfd0eb',
 '20261023010000_credit_native_tariff_audit.sql': '0379703651fca0091c407bb7caca032bbba31b7f1a00b734caef4338c661cba5',
 '20261023110000_knowledge_embedding_accounting.sql': '77ed0b415f8ff5660c5e7d32ea4695c4acd9226b792bf320badaaedaee5b895b',
 '20261023120000_auxiliary_model_accounting.sql': 'c1508e732b4239a8d72e209dbabb234b19409e8346c7b81b3cc180c5924e9ba9',
 '20261023130000_private_auxiliary_model_operations.sql': 'c574b870f20065c24e437f1d0ac5242cf19a481248a7949db77f231696b2c6c1',
}
HISTORICAL_DRIFT = {
 '20260813110000_f174_design_facet_item_revision.sql',
 '20260922010000_drop_research_workflow_sessions.sql',
 '20260924230000_kg_f08_graph_recall.sql',
 '20260926090000_digital_interview_artifact_versions.sql',
}
EXTRA = {'20260916010000_research_workflow_sessions.sql'}


def build(observed, read_source):
    """Freeze exact live metadata for CAS; exceptions remain visible, not repaired."""
    if observed['source'] != SOURCE or not observed['readOnly']:
        raise ValueError('SOURCE_BINDING')
    ledger = observed['ledger']; target = observed['targetSchema']; baseline = observed['baselineSchema']
    if len(ledger) != 425 or len(target) != 431 or len(baseline) != 424:
        raise ValueError('SCHEMA_COUNT_DRIFT')
    if any(target.get(k) != v for k, v in baseline.items()):
        raise ValueError('HISTORICAL_SOURCE_CHANGED')
    if set(target) - set(ledger) != set(PENDING) or set(ledger) - set(target) != EXTRA:
        raise ValueError('PENDING_SET_DRIFT')
    drift = {n for n in ledger if n in target and ledger[n] != target[n]}
    if drift != HISTORICAL_DRIFT:
        raise ValueError('UNREVIEWED_HISTORY_DRIFT')
    spec = importlib.util.spec_from_file_location('cn_components', Path(__file__).with_name('cn-schema-migration-plan.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    migrations = []
    for name, checksum in PENDING.items():
        if target[name] != checksum:
            raise ValueError('TARGET_CHECKSUM_DRIFT')
        migrations.append(module.components(name, read_source(name), checksum))
    return {
        'kind': 'devapp-reviewed-schema-plan-v1', 'source': SOURCE, 'baseline': BASELINE,
        'baselineLedger': dict(ledger),
        'expectedLedger': {**ledger, **PENDING},
        'candidateLedger': dict(target),
        'historicalExceptions': {n: {'observed': ledger[n], 'candidate': target.get(n)} for n in sorted(drift | EXTRA)},
        'migrations': migrations,
        'manualDataPolicy': 'separate-root-operated initialization; no cross-environment import',
        'rollbackPolicy': 'd986 is incompatible with numeric credit fields; restore verified pre-switch database before restarting old services',
    }
