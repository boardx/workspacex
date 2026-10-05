#!/usr/bin/env python3
"""CI-visible pure fixture checks. No deployment, container or DB command."""
import pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
VM=ROOT/'.harness/scripts/vm'
TESTS=['cn-maintenance-activation-test.py','collect_cn_migration_snapshot_test.py','cn_tool_profile_test.py','cn_maintenance_host_launcher_test.py','cn_maintenance_recovery_evidence_verifier_test.py','cn_production_recovery_cli_test.py','cn_production_recovery_executor_test.py','cn_tool_install_transaction_test.py','prepare_cn_tool_install_test.py','precheck_cn_tool_install_test.py']
for test in TESTS:
 # This suite verifies full Git objects and real link rejection fixtures.
 timeout=40 if test=='prepare_cn_tool_install_test.py' else 20
 subprocess.run([sys.executable,'-B',str(VM/test)],cwd=ROOT,check=True,timeout=timeout)
subprocess.run([sys.executable,'-B','-m','unittest','discover','-s',str(VM),'-p','test_*.py'],cwd=ROOT,check=True,timeout=40)
helper_tests=sorted(VM.glob('test_*.cjs'))+[
 VM/'acceptance_receipt_producer_test.cjs',VM/'acceptance_source_closure_test.cjs']
subprocess.run(['node','--test',*[str(p) for p in helper_tests]],cwd=ROOT,check=True,timeout=20)

subprocess.run(['node','--test',str(VM/'cn-maintenance-drain-test.cjs')],cwd=ROOT,check=True,timeout=20)

for test in ['cn-maintenance-browser-test.cjs','cn-maintenance-canonical-test.cjs','cn_restore_catalog_test.cjs','existing_session_restore_test.cjs','restore_sql_stream_test.cjs','existing_fidelity_session_test.cjs','offline_restore_pipeline_test.cjs','retained_session_recovery_test.cjs']:
 subprocess.run(['node','--test',str(VM/test)],cwd=ROOT,check=True,timeout=20)

subprocess.run(['node','--import','tsx','--test',str(ROOT/'packages/cloud-deploy/src/cn-maintenance-host/maintenance_transport_test.ts')],cwd=ROOT,check=True,timeout=20)
