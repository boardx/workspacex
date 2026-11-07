#!/usr/bin/env python3
"""Read-only immutable-image schema routing. A diff NEVER authorizes SQL execution."""
import hashlib
import json
import re


def need(value, code):
    if not value:
        raise ValueError(code)


def encoded(value):
    return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()


def inventory(value,roles=('api','agent')):
    need(type(value) is dict and set(value)==set(roles),'SCHEMA_ROLES_REQUIRED')
    for paths in value.values():
        need(type(paths) is dict and bool(paths),'SCHEMA_PATHS_REQUIRED')
        for path,files in paths.items():
            need(type(path) is str and bool(path) and type(files) is dict and bool(files),'SCHEMA_FILES_REQUIRED')
            for name,checksum in files.items():
                need(type(name) is str and bool(name) and re.fullmatch(r'[A-Za-z0-9_./-]+',name) and '..' not in name.split('/'),'SCHEMA_FILENAME')
                need(type(checksum) is str and re.fullmatch('[a-f0-9]{64}',checksum),'SCHEMA_CHECKSUM')
    return value


def compare(before,after,roles=('api','agent')):
    need(roles in (('api',),('api','agent')),'SCHEMA_ROLES_REQUIRED')
    inventory(before,roles);inventory(after,roles)
    changes=[];maintenance=False
    for role in roles:
        for path in sorted(before[role].keys()|after[role].keys()):
            old=before[role].get(path,{});new=after[role].get(path,{})
            added=sorted(new.keys()-old.keys());removed=sorted(old.keys()-new.keys())
            changed=sorted(name for name in old.keys()&new.keys() if old[name]!=new[name])
            if added or removed or changed:
                changes.append(dict(role=role,path=path,added=added,removed=removed,changed=changed))
                maintenance=maintenance or role=='agent' or bool(removed or changed)
    route='maintenance-review' if maintenance else 'schema-preparation' if changes else 'image-only'
    return {'route':route,'changes':changes,'automaticMigrationAllowed':False}


def plan(environment,tag,source,baseline,candidate,before,after,roles=('api','agent')):
    need(environment in ('devapp','cn','us'),'INVALID_ENVIRONMENT')
    need(type(tag) is str and re.fullmatch(r'(?:[a-f0-9]{40}-)?[1-9][0-9]*-[1-9][0-9]*',tag),'INVALID_RELEASE_TAG')
    need(type(source) is str and re.fullmatch('[a-f0-9]{40}',source),'IMAGE_SOURCE_MISMATCH')
    for images in (baseline,candidate):
        need(type(images) is dict and set(images)==set(roles),'SCHEMA_IMAGES_REQUIRED')
        need(all(type(v) is str and re.fullmatch('sha256:[a-f0-9]{64}',v) for v in images.values()),'IMAGE_ID_REQUIRED')
    result={'kind':'tag-schema-plan-v1','environment':environment,'tag':tag,'sourceRevision':source,
            'baselineImages':baseline,'candidateImages':candidate,'baselineInventories':before,
            'candidateInventories':after,'complete':roles==('api','agent'),
            'uncheckedRoles':[role for role in ('api','agent') if role not in roles],
            **compare(before,after,roles)}
    return {**result,'planSha256':hashlib.sha256(encoded(result)).hexdigest()}


# Match the ENTIRE protected adapter stderr, never extract a token from arbitrary
# text or forward raw exceptions, connection strings, backup paths or SQL.
ADMISSION_CODES=frozenset({'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE','LEDGER_DRIFT',
    'MIGRATION_LEDGER_MISMATCH','BACKUP_REQUIRED','BACKUP_VERIFICATION_FAILED',
    'BACKUP_TOC_INVALID','BACKUP_EXPIRED','BASELINE_DRIFT','RELEASE_LOCK_BUSY'})

def admission_code(raw):
    if type(raw) is bytes and len(raw)<=128:
        code=raw.decode('ascii',errors='replace').strip()
        if code in ADMISSION_CODES:
            return code
    return 'HOST_ADMISSION_REJECTED'
