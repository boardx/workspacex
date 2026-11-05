import importlib.util,json,pathlib,subprocess,unittest
spec=importlib.util.spec_from_file_location('repair',pathlib.Path(__file__).parents[1]/'repair-asr-credit-tariffs.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
VERSION='catalog-cn-2cc7238acdeab60b248b9cd2f65f8afe2ad072ad92e5db1b67fcf16f335632ec'
MOCK=r'''
const fixture=FIXTURE;
Object.assign(process.env,{KERNEL_ASR_BASE_URL:fixture.host??'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',KERNEL_ASR_PROVIDER:'dashscope',KERNEL_ASR_MODEL:'qwen3-asr-flash-realtime',MIGRATION_DB_USER:'operator',MIGRATION_DB_PASSWORD:'test-only',ASR_REPAIR_ACTION:fixture.action,ASR_REPAIR_EXPECTED:fixture.expected??'',ASR_REPAIR_RUN_ID:'12345',ASR_REPAIR_ACTOR:'actual-maintainer'});
let tariffs=fixture.tariffs??[],audits=fixture.audits??[],saved;
const operations=[];
const fixtureClient={release(){},async query(sql,args=[]){operations.push({sql,args});
 if(sql.startsWith('BEGIN'))saved=structuredClone({tariffs,audits});
 if(sql==='ROLLBACK'){tariffs=saved.tariffs;audits=saved.audits;}
 if(sql.startsWith('SELECT id FROM organizations'))return {rows:Array.from({length:fixture.orgCount??18},(_,i)=>({id:'org-'+String(i).padStart(2,'0')}))};
 if(sql.startsWith('SELECT org_id,model_provider'))return {rows:structuredClone(tariffs)};
 if(sql.startsWith('INSERT INTO credit_native_tariffs')){const [org_id,model_provider,model_id,unit,quantum,hundredths_per_quantum,version]=args;tariffs.push({org_id,model_provider,model_id,unit,quantum,hundredths_per_quantum,version});return {rows:[{org_id}]};}
 if(sql.startsWith('INSERT INTO credit_native_tariff_changes')){if(fixture.failAudit)throw Error('private SQL credential');audits.push({org_id:args[0],actor_id:args[1],old_tariff:args[2]===null?null:JSON.parse(args[2]),new_tariff:JSON.parse(args[3])});}
 if(sql.startsWith('SELECT org_id,new_tariff'))return {rows:audits.filter(a=>a.new_tariff.version===args[0]&&a.new_tariff.maintenance?.snapshot===args[1]&&a.old_tariff===null)};
 if(sql.startsWith('DELETE FROM credit_native_tariffs'))tariffs=tariffs.filter(r=>r.org_id!==args[0]);
 return {rows:[]};}};
class Pool{async connect(){return fixtureClient;}async end(){}}
const migrationConfig=()=>({});
const readProductConfiguration=async()=>({version:fixture.catalog??'CATALOG',rows:[]});
const personalConfiguredProducts=()=>[{kind:'credit_topup',currency:'CNY',sku:'credit-cn-10000-v1',amountMinor:12900,credits:10000}];
'''.replace('CATALOG',VERSION)
def execute(action,**fixture):
 fixture['action']=action
 source=MOCK.replace('FIXTURE',json.dumps(fixture))+'\n'+'\n'.join(line for line in m.REPAIR.splitlines()if not line.startswith("import {Pool}")and not line.startswith("import {migrationConfig}")and not line.startswith("import {readProductConfiguration"))
 source+='\nconsole.error(JSON.stringify({operations,tariffs,audits}));'
 result=subprocess.run(['node','--input-type=module'],input=source,text=True,capture_output=True,timeout=15)
 return json.loads(result.stdout),json.loads(result.stderr),result.returncode
class Repair(unittest.TestCase):
 def test_dryrun_is_readonly_and_exact_integer_quantum(self):
  out,state,code=execute('dry-run');self.assertEqual(code,0);self.assertFalse(out['committed']);self.assertEqual(out['missingCount'],18)
  self.assertEqual(out['quote']['quantumMilliseconds'],'4300');self.assertEqual(out['quote']['hundredthsPerQuantum'],'33')
  self.assertTrue(state['operations'][0]['sql'].endswith('READ ONLY'))
  self.assertFalse(any(x['sql'].startswith(('INSERT','UPDATE','DELETE'))for x in state['operations']))
  self.assertEqual((60000*33+4299)//4300,461);self.assertEqual((300000*33+4299)//4300,2303)
 def test_apply_is_one_transaction_and_audits_real_maintenance_source(self):
  preview,_,_=execute('dry-run');out,state,code=execute('apply',expected=preview['snapshot'])
  self.assertEqual(code,0);self.assertEqual(out['affected'],18);self.assertEqual(len(state['tariffs']),18);self.assertEqual(len(state['audits']),18)
  self.assertTrue(all(a['old_tariff']is None and a['actor_id']=='maintenance:github-actions:12345:actual-maintainer:issue6275'for a in state['audits']))
  self.assertEqual(state['operations'][-1]['sql'],'COMMIT')
 def test_explicit_override_is_preserved(self):
  row={'org_id':'org-00','model_provider':'dashscope','model_id':'qwen3-asr-flash-realtime','unit':'millisecond','quantum':'1000','hundredths_per_quantum':'7','version':'approved-override'}
  preview,_,_=execute('dry-run',tariffs=[row]);out,state,code=execute('apply',tariffs=[row],expected=preview['snapshot'])
  self.assertEqual(code,0);self.assertEqual(out['affected'],17);self.assertIn(row,state['tariffs'])
 def test_quote_org_host_snapshot_drift_writes_nothing(self):
  preview,_,_=execute('dry-run')
  for change in [{'catalog':'changed'},{'orgCount':19},{'host':'wss://dashscope-intl.aliyuncs.com/x'},{'expected':'0'*64}]:
   with self.subTest(change=change):
    out,state,code=execute('apply',**({'expected':preview['snapshot']}|change));self.assertEqual(code,1);self.assertFalse(out['committed']);self.assertEqual(state['tariffs'],[])
 def test_audit_failure_rolls_back_all_tariffs_and_redacts_error(self):
  preview,_,_=execute('dry-run');out,state,code=execute('apply',expected=preview['snapshot'],failAudit=True)
  self.assertEqual(code,1);self.assertEqual(state['tariffs'],[]);self.assertEqual(state['audits'],[]);self.assertNotIn('private',json.dumps(out))
 def test_rollback_only_exact_new_rows_and_audits_deletion(self):
  preview,_,_=execute('dry-run');_,state,_=execute('apply',expected=preview['snapshot'])
  out,reverted,code=execute('rollback',expected=preview['snapshot'],tariffs=state['tariffs'],audits=state['audits'])
  self.assertEqual(code,0);self.assertEqual(out['affected'],18);self.assertEqual(reverted['tariffs'],[]);self.assertEqual(len(reverted['audits']),36)
  self.assertTrue(all(a['new_tariff']['deleted']for a in reverted['audits'][18:]))
 def test_rollback_aborts_before_deletion_if_any_price_changed(self):
  preview,_,_=execute('dry-run');_,state,_=execute('apply',expected=preview['snapshot']);state['tariffs'][0]['hundredths_per_quantum']='99'
  out,reverted,code=execute('rollback',expected=preview['snapshot'],tariffs=state['tariffs'],audits=state['audits'])
  self.assertEqual(code,1);self.assertEqual(out['code'],'rollback_tariff_was_modified');self.assertEqual(len(reverted['tariffs']),18)
