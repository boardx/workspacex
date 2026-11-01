import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'scripts/tag-schema-plan.py'
def module():
    spec=importlib.util.spec_from_file_location('tag_schema_plan',SCRIPT)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

class SchemaPlan(unittest.TestCase):
    def test_unchanged_and_additive_routes(self):
        m=module();before={'api':{'migrations':{'001.sql':'a'*64}},'agent':{'runtime':{'lock':'b'*64}}}
        self.assertEqual(m.compare(before,before)['route'],'image-only')
        after=json.loads(json.dumps(before));after['api']['migrations']['002.sql']='c'*64
        plan=m.compare(before,after)
        self.assertEqual(plan['route'],'schema-preparation')
        self.assertEqual(plan['changes'],[{'role':'api','path':'migrations','added':['002.sql'],'removed':[],'changed':[]}])
        self.assertFalse(plan['automaticMigrationAllowed'])
    def test_rewrite_removal_and_agent_changes_require_maintenance(self):
        m=module()
        for after in [{'api':{'m':{'001.sql':'b'*64}},'agent':{'r':{'x':'c'*64}}},
                      {'api':{'m':{'002.sql':'b'*64}},'agent':{'r':{'x':'a'*64}}}]:
            plan=m.compare({'api':{'m':{'001.sql':'a'*64}},'agent':{'r':{'x':'a'*64}}},after)
            self.assertEqual(plan['route'],'maintenance-review')
    def test_missing_role_or_empty_inventory_is_not_unchanged(self):
        m=module()
        for value in [{},{'api':{},'agent':{}},{'api':{'m':{}},'agent':{'r':{'x':'a'*64}}}]:
            with self.assertRaises(ValueError):m.compare(value,value)
    def test_binding_changes_with_baseline_candidate_and_environment(self):
        m=module();inventory={'api':{'m':{'001.sql':'a'*64}},'agent':{'r':{'x':'b'*64}}}
        values=dict(environment='cn',tag='41248889927-1',source='e'*40,baseline={'api':'sha256:'+'1'*64,'agent':'sha256:'+'2'*64},candidate={'api':'sha256:'+'3'*64,'agent':'sha256:'+'4'*64},before=inventory,after=inventory)
        base=m.plan(**values)
        self.assertEqual(base['kind'],'tag-schema-plan-v1')
        for update in [dict(environment='us'),dict(tag='41248889927-2'),dict(source='f'*40),dict(baseline={**values['baseline'],'api':'sha256:'+'5'*64})]:
            self.assertNotEqual(m.plan(**{**values,**update})['planSha256'],base['planSha256'])
    def test_api_only_plan_explicitly_keeps_agent_unchecked(self):
        m=module();v={'api':{'m':{'001.sql':'a'*64}}}
        plan=m.plan('us','41248889927-1','e'*40,{'api':'sha256:'+'1'*64},{'api':'sha256:'+'2'*64},v,v,('api',))
        self.assertFalse(plan['complete']);self.assertEqual(plan['uncheckedRoles'],['agent'])
        self.assertFalse(plan['automaticMigrationAllowed'])

    def test_safe_admission_codes_only_never_forward_raw_errors(self):
        m=module()
        for raw in [b'secret token here',b'{"code":"SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE","secret":"x"}',b'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE\nsecret']:
            self.assertEqual(m.admission_code(raw),'HOST_ADMISSION_REJECTED')
        self.assertEqual(m.admission_code(b'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE\n'),'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE')

if __name__=='__main__':unittest.main()
