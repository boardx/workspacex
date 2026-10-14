import copy
import json
from pathlib import Path
import tempfile
import unittest

import content_sync as sync


class CatalogAdmission(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.entities = []
        for kind in ("skill", "agent", "workflow"):
            path = kind + ".json"
            data = json.dumps({"kind": kind}).encode()
            (self.root / path).write_bytes(data)
            self.entities.append({"kind": kind, "key": kind + "-official", "version": "1.0.0",
                                  "contentDigest": sync.digest(data), "artifactPath": path,
                                  "artifactSha256": sync.digest(data), "dependencies": []})
        self.entities[1]["dependencies"] = [self.ref(self.entities[0])]
        self.entities[2]["dependencies"] = [self.ref(self.entities[0])]
        self.manifest = {"schemaVersion": 1, "releaseId": "test-release", "sourceRevision": "a" * 40,
                         "controlRevision": "b" * 40, "sourceArtifactSha256": "c" * 64,
                         "targetOrgId": "org-platform", "catalogVersion": "implemented-mvp",
                         "acceptanceScope": "mvp-non-model",
                         "skippedTests": ["real-model", "ai-output-quality"],
                         "notApplicableContents": ["future-catalog-v2"],
                         "expectedCounts": {"agent": 1, "skill": 1, "workflow": 1},
                         "entities": self.entities,
                         "requiredTests": [{"id": e["kind"] + "-readback", "entity": self.ref(e),
                                            "gate": "content-readback"} for e in self.entities]}
        self.manifest["catalogClosureSha256"] = sync.closure_digest(self.entities)
        self.inventory = {"schemaVersion": 1, "targetOrgId": "org-platform",
                          "observedAt": "2026-10-14T02:17:00Z", "entities": []}

    @staticmethod
    def ref(e):
        return {k: e[k] for k in ("kind", "key", "version")}

    def admission(self):
        return sync.admit(self.manifest, "a" * 40, self.manifest["catalogClosureSha256"], self.root)

    def reject(self, code, fn=None):
        with self.assertRaises(sync.Rejected) as ctx:
            (fn or self.admission)()
        self.assertEqual(code, ctx.exception.code)

    def row(self, e):
        return {**self.ref(e), "contentDigest": e["contentDigest"], "orgId": "org-platform",
                "origin": "official", "status": "published", "stateDigest": "d" * 64}

    def planned(self):
        by_id, order = self.admission()
        return sync.plan(self.manifest, by_id, order, self.inventory)

    def test_dependency_precedes_agent_and_workflow(self):
        plan = self.planned()
        self.assertEqual("skill", plan["operations"][0]["entity"]["kind"])
        self.assertFalse(plan["executionReady"])
        self.assertFalse(plan["businessAccepted"])
        self.assertFalse(plan["productionWrites"])

    def test_repeated_exact_content_is_reused_and_deterministic(self):
        self.inventory["entities"] = [self.row(e) for e in self.entities]
        a = self.planned()
        self.inventory["entities"].reverse()
        b = self.planned()
        self.assertEqual(a["planSha256"], b["planSha256"])
        self.assertTrue(all(x["action"] == "reuse" for x in a["operations"]))

    def test_artifact_byte_drift_rejected(self):
        (self.root / "agent.json").write_bytes(b"changed")
        self.reject("ARTIFACT_SHA_MISMATCH")

    def test_path_traversal_rejected(self):
        self.entities[0]["artifactPath"] = "../secret"
        self.reject("UNSAFE_ARTIFACT_PATH")

    def test_symlink_rejected(self):
        (self.root / "skill.json").unlink()
        (self.root / "skill.json").symlink_to(self.root / "agent.json")
        self.reject("ARTIFACT_SYMLINK")

    def test_cross_tenant_inventory_rejected(self):
        row = self.row(self.entities[0]); row["orgId"] = "tenant-private"
        self.inventory["entities"] = [row]
        self.reject("TENANT_ROW_REJECTED", self.planned)

    def test_same_version_different_content_rejected(self):
        row = self.row(self.entities[0]); row["contentDigest"] = "e" * 64
        self.inventory["entities"] = [row]
        self.reject("IMMUTABLE_VERSION_CONFLICT", self.planned)

    def test_custom_content_not_overwritten(self):
        row = self.row(self.entities[1]); row["origin"] = "custom"
        self.inventory["entities"] = [row]
        self.reject("CUSTOM_CONTENT_CONFLICT", self.planned)

    def test_legacy_agent_requires_explicit_adoption(self):
        row = self.row(self.entities[1]); row["version"] = "0.9.0"
        self.inventory["entities"] = [row]
        self.reject("AGENT_LEGACY_ADOPTION_REQUIRED", self.planned)

    def test_legacy_cas_validates_all_expected_state(self):
        e = self.entities[1]; row = self.row(e); row["version"] = "0.9.0"
        self.inventory["entities"] = [row]
        e["legacyAdoption"] = {"fromVersion": row["version"], "fromDigest": row["contentDigest"],
                               "expectedStateDigest": row["stateDigest"]}
        self.assertIn("append-legacy-compatible", [x["action"] for x in self.planned()["operations"]])
        row["stateDigest"] = "e" * 64
        self.reject("LEGACY_CAS_MISMATCH", self.planned)

    def test_dependency_missing_rejected(self):
        self.entities[1]["dependencies"][0]["key"] = "absent"
        self.reject("DEPENDENCY_MISSING")

    def test_dependency_cycle_rejected(self):
        self.entities[0]["dependencies"] = [self.ref(self.entities[1])]
        self.reject("DEPENDENCY_CYCLE")

    def test_partial_catalog_counts_rejected(self):
        self.manifest["expectedCounts"]["skill"] = 200
        self.reject("CATALOG_COUNT_MISMATCH")

    def test_missing_readback_test_rejected(self):
        self.manifest["requiredTests"].pop()
        self.reject("REQUIRED_TEST_COVERAGE_MISSING")

    def test_full_catalog_cannot_use_mvp_tests(self):
        self.manifest["acceptanceScope"] = "full-catalog"
        self.manifest["catalogVersion"] = "v2"
        self.reject("REQUIRED_TEST_COVERAGE_MISSING")

    def test_mvp_requires_explicit_skips(self):
        self.manifest["skippedTests"] = []
        self.reject("MVP_EXCLUSIONS_REQUIRED")

    def test_source_mismatch(self):
        self.manifest["sourceRevision"] = "f" * 40
        self.reject("SOURCE_MISMATCH")

    def test_independently_reviewed_closure_required(self):
        self.reject("CATALOG_CLOSURE_MISMATCH", lambda: sync.admit(self.manifest, "a" * 40, "f" * 64, self.root))

    def test_duplicate_json_keys_rejected(self):
        path = self.root / "duplicate.json"
        data = b'{"schemaVersion":1,"schemaVersion":2}'
        path.write_bytes(data)
        self.reject("JSON_DUPLICATE_KEY", lambda: sync.load_bound(path, sync.digest(data)))

    def test_raw_manifest_byte_binding(self):
        path = self.root / "manifest.json"
        data = sync.canonical(self.manifest); path.write_bytes(data)
        expected = sync.digest(data)
        path.write_bytes(data + b"\n")
        self.reject("RAW_SHA_MISMATCH", lambda: sync.load_bound(path, expected))


if __name__ == "__main__":
    unittest.main()
