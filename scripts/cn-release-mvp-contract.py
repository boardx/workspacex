#!/usr/bin/env python3
"""One strict MVP authorization metadata schema, shared by trusted consumers."""
import re
BASE_FIELDS = frozenset(('acceptanceScope','contentManifestSha256','buildRunId','transferRunId'))
STAGE_INPUT_FIELDS = frozenset(('profileSha256','schemaRequestSha256','contentRequestSha256','contentBackupSha256','nonmodelFixturesSha256','nonmodelCredentialsSha256'))
HEX = re.compile(r'[a-f0-9]{64}')
def validate_metadata(value):
    if not isinstance(value,dict) or set(value) not in (BASE_FIELDS, BASE_FIELDS | {'stageInputs'}):
        raise ValueError('MVP_SCOPE')
    if value['acceptanceScope'] != 'mvp-non-model': raise ValueError('MVP_SCOPE')
    if not isinstance(value['contentManifestSha256'],str) or not HEX.fullmatch(value['contentManifestSha256']): raise ValueError('MVP_CONTENT_PIN')
    if not all(type(value[k]) is int and value[k] > 0 for k in ('buildRunId','transferRunId')): raise ValueError('MVP_RUNS')
    if 'stageInputs' in value:
        pins=value['stageInputs']
        if not isinstance(pins,dict) or set(pins)!=STAGE_INPUT_FIELDS: raise ValueError('MVP_STAGE_INPUTS')
        if not all(isinstance(pin,str) and HEX.fullmatch(pin) for pin in pins.values()): raise ValueError('MVP_STAGE_INPUT_PIN')
    return value
