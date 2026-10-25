#!/usr/bin/env python3
"""Root-operated DevApp release 5921. Defaults to isolated rehearsal only.

The protected plan and source bytes are prepared separately. No force/replay,
no historical checksum repair, no production execution through runner sudo.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

ROOT = Path('/root/wsx-devapp-5921-plan')
CONTAINER = 'wsx-devapp-5921-physical-rehearsal'
SOURCE = '7265bb89a9d4cc7bac9ca11ff638eb5a3c8a02d0'

def quote(s):
    return "'" + s.replace("'", "''") + "'"

def ledger_guard(ledger):
    expected = quote(json.dumps(ledger, sort_keys=True))
    return f"DO $guard$ BEGIN IF (SELECT jsonb_object_agg(name,checksum) FROM public._kernel_migrations) IS DISTINCT FROM {expected}::jsonb THEN RAISE EXCEPTION 'RELEASE_LEDGER_DRIFT'; END IF; END $guard$;"

def compile_step(plan, mode, plan_hash):
    pure = [f for f in plan['migrations'] if all(c['kind'] == 'schema' for c in f['components'])]
    partial = [f for f in plan['migrations'] if any(c['kind'] == 'manual-data' for c in f['components'])]
    schema_ledger = {**plan['baselineLedger'], **{f['name']:f['sourceChecksum'] for f in pure}}
    before = plan['baselineLedger'] if mode == 'schema' else schema_ledger
    after = schema_ledger if mode == 'schema' else plan['expectedLedger']
    parts = ['BEGIN;', "SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='60s';", 'SELECT pg_advisory_xact_lock(8014530119003001);', ledger_guard(before)]
    if mode == 'schema':
        parts += ["CREATE TABLE public._workspacex_release_components_5921(name text NOT NULL,source_checksum text NOT NULL,component_index integer NOT NULL,kind text NOT NULL CHECK(kind IN ('schema','manual-data')),sql_checksum text NOT NULL,plan_checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(name,component_index));"]
    else:
        parts += ["DO $guard$ BEGIN IF (SELECT count(*) FROM public.credit_consumption_settings)<>0 THEN RAISE EXCEPTION 'INITIALIZATION_NONEMPTY'; END IF; END $guard$;"]
        expected = []
        for f in plan['migrations']:
            for i,c in enumerate(f['components']):
                if c['kind'] == 'schema':
                    expected.append({'name':f['name'],'source_checksum':f['sourceChecksum'],'component_index':i,'kind':c['kind'],'sql_checksum':c['sha256'],'plan_checksum':plan_hash})
        parts += ["DO $guard$ BEGIN IF (SELECT jsonb_agg(to_jsonb(x) ORDER BY name,component_index) FROM (SELECT name,source_checksum,component_index,kind,sql_checksum,plan_checksum FROM public._workspacex_release_components_5921) x) IS DISTINCT FROM " + quote(json.dumps(sorted(expected,key=lambda x:(x['name'],x['component_index'])))) + "::jsonb THEN RAISE EXCEPTION 'SCHEMA_COMPONENT_DRIFT'; END IF; END $guard$;"]
    for f in plan['migrations']:
        for i,c in enumerate(f['components']):
            if c['kind'] != ('schema' if mode == 'schema' else 'manual-data'):
                continue
            parts.append(c['sql'])
            vals = [quote(f['name']),quote(f['sourceChecksum']),str(i),quote(c['kind']),quote(c['sha256']),quote(plan_hash)]
            parts.append('INSERT INTO public._workspacex_release_components_5921(name,source_checksum,component_index,kind,sql_checksum,plan_checksum) VALUES('+','.join(vals)+');')
        if f in (pure if mode == 'schema' else partial):
            parts.append('INSERT INTO public._kernel_migrations(name,checksum) VALUES('+quote(f['name'])+','+quote(f['sourceChecksum'])+');')
    parts += [ledger_guard(after), 'COMMIT;']
    return '\n'.join(parts), after

def main():
    if os.geteuid()!=0 or socket.gethostname()!='iZrj94o0jq479xfhoa83xoZ' or sys.argv[1:]!=['rehearse']:
        raise ValueError('REHEARSAL_ONLY')
    raw=(ROOT/'plan.json').read_bytes(); plan=json.loads(raw); plan_hash=hashlib.sha256(raw).hexdigest()
    if plan['source']!=SOURCE or len(plan['migrations'])!=7:
        raise ValueError('PLAN_SOURCE')
    for f in plan['migrations']:
        b=(ROOT/f['name']).read_bytes()
        if hashlib.sha256(b).hexdigest()!=f['sourceChecksum'] or b!=b''.join(c['sql'].encode() for c in f['components']):
            raise ValueError('SOURCE_CLOSURE')
    x=json.loads(subprocess.check_output(['docker','inspect','workspacex-postgres-1']))[0]
    owner=dict(v.split('=',1) for v in x['Config']['Env']).get('POSTGRES_USER','postgres')
    subprocess.run(['docker','start',CONTAINER],check=True,capture_output=True)
    try:
        import time
        for _ in range(40):
            p=subprocess.run(['docker','exec',CONTAINER,'pg_isready','-U',owner],capture_output=True)
            if p.returncode==0:break
            time.sleep(1)
        else:raise ValueError('CLONE_NOT_READY')
        for mode in ['schema','manual-data']:
            sql, expected=compile_step(plan,mode,plan_hash)
            p=subprocess.run(['docker','exec','-i',CONTAINER,'psql','-X','-q','-A','-t','--set=ON_ERROR_STOP=1','-U',owner,'-d','workspacex'],input=sql.encode(),capture_output=True,timeout=300)
            (ROOT/('rehearsal-'+mode+'.stderr')).write_bytes(p.stderr)
            if p.returncode!=0:raise ValueError('REHEARSAL_QUERY_REJECTED:'+mode)
            print(json.dumps({'mode':mode,'status':'REHEARSED_COMMIT','ledgerCount':len(expected),'productionChanged':False}),flush=True)
        sql="BEGIN READ ONLY; SELECT jsonb_build_object('ledgerCount',(SELECT count(*) FROM _kernel_migrations),'settingsRows',(SELECT count(*) FROM credit_consumption_settings WHERE singleton AND NOT credit_preflight_enabled),'balanceType',(SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='credit_wallets' AND column_name='balance'),'orphanAttachments',(SELECT count(*) FROM chat_message_attachments a LEFT JOIN chat_messages m ON m.id=a.message_id WHERE m.id IS NULL)); ROLLBACK;"
        p=subprocess.run(['docker','exec',CONTAINER,'psql','-X','-q','-A','-t','--set=ON_ERROR_STOP=1','-U',owner,'-d','workspacex','-c',sql],capture_output=True,check=True)
        result=json.loads(p.stdout);assert result=={'ledgerCount':432,'settingsRows':1,'balanceType':'numeric','orphanAttachments':22}
        receipt={'status':'MIGRATION_REHEARSAL_VERIFIED','planChecksum':plan_hash,'productionChanged':False,'readback':result}
        (ROOT/'rehearsal-receipt.json').write_text(json.dumps(receipt));print(json.dumps(receipt),flush=True)
    finally:
        subprocess.run(['docker','stop','--time=20',CONTAINER],capture_output=True,timeout=30)

if __name__=='__main__':main()
