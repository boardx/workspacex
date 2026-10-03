#!/usr/bin/env python3
"""CI-visible pure fixture checks. No deployment, container or DB command."""
import pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
VM=ROOT/'.harness/scripts/vm'
TESTS=['cn-maintenance-activation-test.py','collect_cn_migration_snapshot_test.py','cn_tool_profile_test.py','cn_maintenance_host_launcher_test.py','cn_maintenance_recovery_evidence_verifier_test.py','cn_production_recovery_cli_test.py','cn_production_recovery_executor_test.py','cn_tool_install_transaction_test.py','prepare_cn_tool_install_test.py']
for test in TESTS:
 subprocess.run([sys.executable,'-B',str(VM/test)],cwd=ROOT,check=True,timeout=20)
subprocess.run([sys.executable,'-B','-m','unittest','discover','-s',str(VM),'-p','test_*.py'],cwd=ROOT,check=True,timeout=20)
subprocess.run(['node','--test',str(VM/'test_control_connection.cjs')],cwd=ROOT,check=True,timeout=20)

subprocess.run(['node','--test',str(VM/'cn-maintenance-drain-test.cjs')],cwd=ROOT,check=True,timeout=20)

for test in ['cn-maintenance-browser-test.cjs','cn-maintenance-canonical-test.cjs','cn_restore_catalog_test.cjs','existing_session_restore_test.cjs','restore_sql_stream_test.cjs','existing_fidelity_session_test.cjs','offline_restore_pipeline_test.cjs','retained_session_recovery_test.cjs']:
 subprocess.run(['node','--test',str(VM/test)],cwd=ROOT,check=True,timeout=20)
