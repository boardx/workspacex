"""Offline compiler for this reviewed CN release only; never connects to a host."""
from pathlib import Path
import ast,hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[3]
SOURCE='151526a4f8dea1ad781d709ab8e3357f52714a96';TAG='41502993193-1'
OLD_SOURCE='e44119db91e9539418ad605ca6aaef2c155d0116';OLD_TAG='41248889927-1'
NAMES=['20261101220000_personal_credit_packages.sql','20261101230000_personal_credit_terms.sql','20261101233000_personal_credit_schedule.sql','20261102000000_welcome_credit_periods.sql','20261102010000_personal_checkout_intents.sql','20261102020000_personal_payment_receipts.sql','20261102030000_personal_stripe_bindings.sql','20261102030500_credit_grant_precision.sql','20261102031000_org_commercial_capacity.sql','20261102040000_personal_payment_recovery.sql','20261102050000_product_configuration.sql']

def build(output):
 OUTPUT=Path(output)
 def original(name):return subprocess.check_output(['git','show','5219b7dd81eb24f9346e67d12de9f716f14ab05a:scripts/'+name],cwd=ROOT).decode()
 def literal(name,var):
  return next(ast.literal_eval(n.value) for n in ast.parse(original(name)).body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id==var for t in n.targets))
 migrations={name:hashlib.sha256(subprocess.check_output(['git','show',SOURCE+':apps/api/migrations/'+name],cwd=ROOT)).hexdigest() for name in NAMES}
 closure=literal('cn-reviewed-tag-prepare.py','CLOSURE')
 extra=('schema-acl-source-prepare.py','schema-acl-rehearsal.py','schema-cn-acl-profile.py')
 files={name:original(name).replace(OLD_SOURCE,SOURCE).replace(OLD_TAG,TAG).replace('/etc/workspacex-image-release/cn-reviewed-tag-release.json','/etc/workspacex-image-release/cn-reviewed-tag-release-6150.json') for name in (*closure,*extra)}
 for name in ('cn-reviewed-tag-prepare.py','cn-reviewed-tag-release.py'):
  files[name]=files[name].replace('==435','==438')
 core='schema-restore-rehearsal.py'
 files[core],n=re.subn(r'MIGRATIONS=\{.*?\n\}', 'MIGRATIONS='+repr(migrations),files[core],count=1,flags=re.S);assert n==1
 js='tag-reviewed-migration-driver.mjs'
 files[js],n=re.subn(r'export const reviewed=\{.*?\n\};','export const reviewed='+json.dumps(migrations)+';',files[js],count=1,flags=re.S);assert n==1
 # The existing fixed release flow retains its full-restore boundary. Require a
 # real stopped-writer original-owner/ACL restore rehearsal before migration;
 # this is qualified separately below, not asserted by an operator boolean.
 extra_closure=(*extra,'cn-reviewed-backup-6150.py')
 for name in ('cn-reviewed-tag-prepare.py','cn-reviewed-tag-release.py'):
  files[name],n=re.subn(r"^CLOSURE=(.+)$",lambda match:"CLOSURE="+repr(tuple(ast.literal_eval(match[1]))+extra_closure),files[name],count=1,flags=re.M);assert n==1
 # prepare CLOSURE ends in old probe but its list is longer; require all extras.
 for name in ('cn-reviewed-tag-prepare.py','cn-reviewed-tag-release.py'):
  tree=ast.parse(files[name]);actual=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CLOSURE' for t in n.targets))
  assert set(extra_closure)<=set(actual),name
 # Backup helper is itself pinned as part of the fixed caller's complete closure.
 files['cn-reviewed-tag-release.py']=files['cn-reviewed-tag-release.py'].replace(" if schema_state=='COMPLETE':need(initial_state=='COMPLETE','COMPLETE_SCHEMA_REQUIRED')"," need(initial_state=='BASELINE' and schema_state is None,'FIRST_BASELINE_SCHEMA_REQUIRED')")
 files['cn-reviewed-tag-release.py']=files['cn-reviewed-tag-release.py'].replace("  intent=True;transaction=migrate_once", "  restore_module=load('cn-reviewed-backup-6150',ctx['policy']['closurePins']);restore_ref=restore_module.qualify(backup,adapter,ctx,metadata);backup_proof['ownerAclRehearsal']=restore_ref\n  intent=True;transaction=migrate_once")
 assert "restore_module=load" in files['cn-reviewed-tag-release.py']
 files['cn-reviewed-tag-release.py']=files['cn-reviewed-tag-release.py'].replace(" adapter=m['cn-tag-migration-adapter'].Adapter(attempt,ctx['fd']);metadata=read(pinned(b['metadata']));", " load('cn-reviewed-backup-6150',ctx['policy']['closurePins']).verify(b['ownerAclRehearsal'],attempt,core.MIGRATIONS)\n adapter=m['cn-tag-migration-adapter'].Adapter(attempt,ctx['fd']);metadata=read(pinned(b['metadata']));")
 helper=Path(__file__).with_name('cn-reviewed-backup-6150.py').read_text();files['cn-reviewed-backup-6150.py']=helper
 OUTPUT.mkdir(mode=0o700,exist_ok=False)
 for name,source in files.items():
  assert OLD_SOURCE not in source and OLD_TAG not in source,name
  if name.endswith('.py'):compile(source,name,'exec')
  p=OUTPUT/name;p.write_text(source);p.chmod(0o700)
 manifest={'kind':'cn-fixed-reviewed-closure-6150','source':SOURCE,'tag':TAG,'baselineLedgerCount':438,'migrations':migrations,'files':{n:hashlib.sha256(s.encode()).hexdigest() for n,s in files.items()}}
 (OUTPUT/'bundle.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n')
 print(json.dumps({'output':str(OUTPUT),'files':len(files),'bundleSha256':hashlib.sha256((OUTPUT/'bundle.json').read_bytes()).hexdigest()}))
if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args();build(args.output)
