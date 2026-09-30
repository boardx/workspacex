import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from validate_preflight import validate

ROOT = Path(__file__).resolve().parents[4]
BUILDER = ROOT / ".harness/scripts/vm/cn-release-preflight-evidence.mjs"
SHA = "a" * 40
BASE = "b" * 40

class CollectorIntegration(unittest.TestCase):
    def invoke(self, phase="prebuild", bad=None):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)
            manifest={"images":{s:{"image":"registry/repo@sha256:"+str(i)*64} for i,s in enumerate(["api","web","agent","sandbox"],1)}}
            (directory/"manifest").write_text(json.dumps(manifest))
            boot={"sourceSha":SHA,"phase":phase,"ready":True,"readOnlyTransaction":True,"productionWriteStatements":0,"stateClass":"matching-existing","checks":{("sourceEntrypoint" if phase=="prebuild" else "imageEntrypoint"):True,"inputContract":True,"schemaContract":True,"permissionContract":True,"agentSeedContract":True},"blockers":[],"adminEmailSha256":"c"*64}
            if phase=="preactivate": boot["imageDigest"]="sha256:"+"1"*64
            if bad=="identity":boot["sourceSha"]=BASE
            if bad=="schema":boot["ready"]=False;boot["checks"]["schemaContract"]=False;boot["blockers"]=["BOOTSTRAP_DB_SCHEMA_INCOMPATIBLE"]
            if bad=="static":boot["readOnlyTransaction"]=False
            records={"bootstrap":"CN_BOOTSTRAP_COMPAT_JSON="+json.dumps(boot),"runtime":"CN_RUNTIME_ENVIRONMENT_PREFLIGHT_JSON="+json.dumps({"ready":True}),"stable":"CN_STABLE_SECRET_PREFLIGHT "+json.dumps({"ready":True}),"managed":"CN_MANAGED_DATA_PREFLIGHT_JSON="+json.dumps({"passed":True})}
            for name,record in records.items():(directory/name).write_text(("noise\n" if bad=="noise" and name=="bootstrap" else "")+record+"\n")
            (directory/"protocol").write_text("STABLE_SECRET_DIRECTORY_DRIFT\n")
            args=["node",str(BUILDER),str(directory/"result"),phase,"attempt-1",SHA,BASE,"2026.9.30-cn.1","8","3600","/usr/bin/chromium",str(directory/"manifest"),str(directory/"prior"),*[str(directory/name) for name in ["bootstrap","runtime","stable","managed","protocol"]]]
            result=subprocess.run(args,text=True,capture_output=True)
            if result.returncode:return result.returncode,None
            evidence=json.loads((directory/"result").read_text())
            # This is the live lock attestation emitted by the trusted verifier.
            evidence["checks"]["runtime.release_lock"]["metadata"]={"heldByAttempt":True,"attemptId":"attempt-1"}
            return result.returncode,validate(evidence)

    def test_collector_output_matches_real_validator(self):
        status,result=self.invoke()
        self.assertEqual(status,0)
        self.assertTrue(result["ready"])

    def test_unknown_schema_static_only_identity_and_noisy_stdout_fail(self):
        for bad in ["schema","static","identity","noise"]:
            with self.subTest(bad=bad):
                status,_=self.invoke(bad=bad)
                self.assertNotEqual(status,0)

    def test_legitimate_parent_is_not_orphan_but_sibling_is(self):
        path=ROOT/".harness/scripts/vm/cn-release-orphans.py"
        spec=importlib.util.spec_from_file_location("orphans",path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        records={1:(0,"init"),2:(1,"workspacex-cn-build-candidate"),3:(2,"collect-cn-release-preflight"),4:(3,"python cn-release-orphans"),5:(1,"docker buildx build leftover")}
        self.assertEqual(module.orphan_pids(records,4),[5])

if __name__=="__main__":unittest.main()
