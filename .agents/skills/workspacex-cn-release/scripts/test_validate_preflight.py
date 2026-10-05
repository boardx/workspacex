#!/usr/bin/env python3
"""Counterexamples for stage-specific, fail-closed CN release evidence."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from validate_preflight import ContractError, MANAGED_DATA_DESCRIBE_ACTIONS, REQUIRED, SERVICES, receipt_hash, validate

SHA = "a" * 40
IMAGE_DIGESTS = {
    "api": "sha256:" + "1" * 64,
    "web": "sha256:" + "2" * 64,
    "agent": "sha256:" + "3" * 64,
    "sandbox": "sha256:" + "4" * 64,
}
NOW = datetime(2026, 9, 15, 13, 0, tzinfo=timezone.utc)


def fixture(phase: str = "prebuild") -> dict:
    checks = {key: {"status": "passed", "evidenceSha256": "c" * 64} for key in REQUIRED}
    checks["source.exact_sha"]["metadata"] = {"requestedSha": SHA, "repositoryHead": SHA, "mirrorHead": SHA}
    checks["source.complete_artifact"]["metadata"] = {"complete": True, "offline": True}
    checks["source.offline_plan_b"]["metadata"] = {"githubRequired": False}
    checks["toolchain.package_manager"]["metadata"] = {"declared": "pnpm@9.15.0", "actual": "9.15.0"}
    checks["toolchain.pnpm_cli_protocol"]["metadata"] = {"doubleDashForwardingPassed": True}
    checks["toolchain.stdout_protocol"]["metadata"] = {"exactlyOneMachineRecord": True}
    checks["toolchain.browser_runtime"]["metadata"] = {"browserExecutable": "/usr/bin/chromium", "playwrightResolved": True, "launchPassed": True}
    checks["registry.acr_auth"]["metadata"] = {"authenticatedProbe": True, "remainingTtlSeconds": 3600}
    checks["runtime.release_lock"]["metadata"] = {"heldByAttempt": True, "attemptId": "attempt-1"}
    checks["runtime.no_orphans"]["metadata"] = {"scanPassed": True, "count": 0}
    checks["config.release_manifest"]["metadata"] = {"sourceSha": SHA, "release": "2026.9.15-cn.2", "kind": "source-plan"}
    checks["config.durable_profiles"]["metadata"] = {"asrConfigured": True, "githubIssueConfigured": True, "platformSuperuserConfigured": True}
    checks["config.secret_serialization"]["metadata"] = {"checkedRefs": 7, "invalidKeys": []}
    checks["cloud.managed_data_permissions"]["metadata"] = {
        "mode": "temporary-policy",
        "liveDescribePassed": True,
        "passedActions": sorted(MANAGED_DATA_DESCRIBE_ACTIONS),
        "temporaryPolicyExpires": True,
        "cleanupRegistered": True,
    }
    checks["database.drain_read_access"]["metadata"] = {"role": "app_diag_ro", "canReadAgentRuns": True}
    checks["bootstrap.compatibility"]["metadata"] = {"evidenceMode": "source-static", "readOnlyTransaction": False, "productionWriteStatements": 0, "sourceEntrypoint": True, "inputContract": True, "schemaContract": False, "permissionContract": False, "stateClass": "unknown", "agentSeedContract": False, "exactlyOneMachineRecord": True}
    checks["bootstrap.compatibility"]["metadata"].update(baselineSha="e" * 40, migrationPlanSha256="d" * 64, baselineSchemaSha256="f" * 64, baselineLedgerContract=True, baselineSchemaContract=True, baselinePermissionContract=True, candidateSchemaContract=False, buildAdmissionOnly=True)
    checks["secrets.stable_continuity"]["metadata"] = {"requiredCount": 12, "matchedCount": 12, "missingKeyIds": [], "rotatedKeyIds": [], "consumerDriftIds": [], "stableDirectory": True, "baselineReadable": True, "candidateWillReuse": True, "noMutation": True}
    checks["build.affected_services"]["metadata"] = {"diffComputed": True, "baselineSha": "e" * 40, "sourceSha": SHA, "services": ["api", "web"]}
    checks["deploy.trusted_copy"]["metadata"] = {"hashesMatch": True, "checkedEntrypoints": 4}
    checks["network.dependencies"]["metadata"] = {"probed": True, "acr": True, "oss": True, "rds": True, "redis": True}
    if phase == "preactivate":
        checks["config.release_manifest"]["metadata"].update(kind="sealed-images", imageDigests=IMAGE_DIGESTS.copy())
        boot = checks["bootstrap.compatibility"]["metadata"]
        boot.pop("sourceEntrypoint")
        for key in ("baselineSha", "migrationPlanSha256", "baselineSchemaSha256", "baselineLedgerContract", "baselineSchemaContract", "baselinePermissionContract", "candidateSchemaContract", "buildAdmissionOnly"):
            boot.pop(key)
        boot.update(imageEntrypoint=True, evidenceMode="database-dynamic", readOnlyTransaction=True, schemaContract=True, migrationLedgerContract=True, permissionContract=True, agentSeedContract=True, stateClass="matching-existing")
        checks["build.target_images"] = {
            "status": "passed",
            "evidenceSha256": "d" * 64,
            "metadata": {
                "services": {
                    service: {"sourceSha": SHA, "digest": IMAGE_DIGESTS[service], "entrypointVerified": True}
                    for service in SERVICES
                }
            },
        }
    result = {"schemaVersion": 2, "phase": phase, "attemptId": "attempt-1", "sourceSha": SHA, "baselineSha": "e" * 40, "release": "2026.9.15-cn.2", "issuedAt": "2026-09-15T12:55:00Z" if phase == "prebuild" else "2026-09-15T12:58:00Z", "expiresAt": "2026-09-15T13:55:00Z" if phase == "prebuild" else "2026-09-15T13:58:00Z", "buildStarted": phase == "preactivate", "checks": checks}
    if phase == "preactivate":
        prior = fixture()
        result["prebuildEvidence"] = prior
        result["prebuildReceiptSha256"] = receipt_hash(prior)
    return result


class TestValidatePreflight(unittest.TestCase):
    def reject(self, data: dict) -> None:
        with self.assertRaises(ContractError):
            validate(data, NOW)

    def artifact(self):
        value=fixture();value['phase']='artifact-build'
        boot=value['checks']['bootstrap.compatibility']['metadata']
        for key in ('baselineSha','migrationPlanSha256','baselineSchemaSha256','baselineLedgerContract','baselineSchemaContract','baselinePermissionContract'): boot.pop(key)
        return value

    def test_artifact_build_without_baseline_is_scoped_only_to_build(self):
        value=self.artifact();self.assertTrue(validate(value,NOW)['ready'])
        value['phase']='prebuild';self.reject(value)

    def test_artifact_receipt_cannot_substitute_activation_lineage(self):
        value=fixture('preactivate');value['prebuildEvidence']=self.artifact()
        value['prebuildReceiptSha256']=receipt_hash(value['prebuildEvidence']);self.reject(value)

    def test_artifact_still_requires_exact_source_lock_and_trusted_tools(self):
        for key,field in [('source.exact_sha','mirrorHead'),('runtime.release_lock','heldByAttempt'),('deploy.trusted_copy','hashesMatch')]:
            value=self.artifact();value['checks'][key]['metadata'][field]=False
            self.reject(value)

    def test_artifact_cannot_claim_baseline_database_readiness(self):
        value=self.artifact();value['checks']['bootstrap.compatibility']['metadata']['baselineLedgerContract']=True
        self.reject(value)

    def test_prebuild_without_image_is_ready_to_build(self) -> None:
        result = validate(fixture(), NOW)
        self.assertTrue(result["ready"])
        self.assertFalse(result["buildStarted"])
        self.assertEqual(result["phase"], "prebuild")

    def test_preactivate_with_exact_sealed_image_is_ready(self) -> None:
        result = validate(fixture("preactivate"), NOW)
        self.assertTrue(result["ready"])
        self.assertEqual(result["checkedCount"], len(REQUIRED) + 1)

    def test_static_proof_never_claims_database_readiness(self) -> None:
        for key, value in [("schemaContract", True), ("permissionContract", True), ("agentSeedContract", True), ("readOnlyTransaction", True), ("stateClass", "empty"), ("inputContract", False)]:
            data = fixture()
            data["checks"]["bootstrap.compatibility"]["metadata"][key] = value
            self.reject(data)

    def test_activation_requires_every_dynamic_database_check(self) -> None:
        for key, value in [("schemaContract", False), ("permissionContract", False), ("agentSeedContract", False), ("readOnlyTransaction", False), ("evidenceMode", "source-static"), ("stateClass", "unknown")]:
            data = fixture("preactivate")
            data["checks"]["bootstrap.compatibility"]["metadata"][key] = value
            self.reject(data)

    def test_prebuild_cannot_claim_image_or_use_target_check(self) -> None:
        data = fixture()
        data["checks"]["bootstrap.compatibility"]["metadata"]["imageEntrypoint"] = True
        self.reject(data)
        data = fixture()
        data["checks"]["build.target_images"] = {"status": "passed", "evidenceSha256": "d" * 64}
        self.reject(data)

    def test_preactivate_requires_all_four_images_and_exact_identity(self) -> None:
        data = fixture("preactivate")
        del data["checks"]["build.target_images"]
        self.reject(data)
        for field, bad in [("sourceSha", "f" * 40), ("digest", "sha256:" + "f" * 64), ("entrypointVerified", False)]:
            data = fixture("preactivate")
            data["checks"]["build.target_images"]["metadata"]["services"]["api"][field] = bad
            self.reject(data)
        data = fixture("preactivate")
        del data["checks"]["build.target_images"]["metadata"]["services"]["sandbox"]
        self.reject(data)
        data = fixture("preactivate")
        data["checks"]["config.release_manifest"]["metadata"]["imageDigests"]["api"] = "sha256:" + "f" * 64
        self.reject(data)

    def test_browser_runtime_requires_absolute_launchable_system_browser(self) -> None:
        for field, bad in [("browserExecutable", "chromium"), ("playwrightResolved", False), ("launchPassed", False)]:
            data = fixture()
            data["checks"]["toolchain.browser_runtime"]["metadata"][field] = bad
            self.reject(data)

    def test_fabricated_pass_metadata_is_rejected(self) -> None:
        mutations = {
            "source exact": lambda data: data["checks"]["source.exact_sha"]["metadata"].update(mirrorHead="f" * 40),
            "pnpm protocol": lambda data: data["checks"]["toolchain.pnpm_cli_protocol"]["metadata"].update(doubleDashForwardingPassed=False),
            "stdout protocol": lambda data: data["checks"]["toolchain.stdout_protocol"]["metadata"].update(exactlyOneMachineRecord=False),
            "attempt lock": lambda data: data["checks"]["runtime.release_lock"]["metadata"].update(attemptId="other-attempt"),
            "orphan scan": lambda data: data["checks"]["runtime.no_orphans"]["metadata"].update(scanPassed=False),
            "durable profiles": lambda data: data["checks"]["config.durable_profiles"]["metadata"].update(asrConfigured=False),
            "affected diff": lambda data: data["checks"]["build.affected_services"]["metadata"].update(diffComputed=False),
            "trusted copy": lambda data: data["checks"]["deploy.trusted_copy"]["metadata"].update(hashesMatch=False),
            "network probe": lambda data: data["checks"]["network.dependencies"]["metadata"].update(rds=False),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                data = fixture()
                mutate(data)
                self.reject(data)

    def test_sensitive_or_unknown_metadata_keys_are_rejected(self) -> None:
        for check, key in (("source.exact_sha", "accessToken"), ("cloud.managed_data_permissions", "apiKey"), ("network.dependencies", "password")):
            with self.subTest(check=check):
                data = fixture()
                data["checks"][check]["metadata"][key] = "must-not-be-recorded"
                self.reject(data)

    def test_managed_data_accepts_bounded_temporary_or_resource_scoped_persistent_mode(self) -> None:
        self.assertTrue(validate(fixture(), NOW)["ready"])
        persistent = fixture()
        persistent["checks"]["cloud.managed_data_permissions"]["metadata"] = {
            "mode": "persistent-resource-scoped-read-only",
            "liveDescribePassed": True,
            "passedActions": sorted(MANAGED_DATA_DESCRIBE_ACTIONS),
            "resourceScoped": True,
            "readOnlyActionsOnly": True,
        }
        self.assertTrue(validate(persistent, NOW)["ready"])

        for mutate in (
            lambda value: value["passedActions"].pop(),
            lambda value: value["passedActions"].append(value["passedActions"][0]),
            lambda value: value.update(resourceScoped=False),
            lambda value: value.update(readOnlyActionsOnly=False),
            lambda value: value.update(mode="unknown"),
        ):
            data = fixture()
            managed = data["checks"]["cloud.managed_data_permissions"]["metadata"]
            managed.clear()
            managed.update({
                "mode": "persistent-resource-scoped-read-only",
                "liveDescribePassed": True,
                "passedActions": sorted(MANAGED_DATA_DESCRIBE_ACTIONS),
                "resourceScoped": True,
                "readOnlyActionsOnly": True,
            })
            mutate(managed)
            self.reject(data)

        data = fixture()
        data["checks"]["cloud.managed_data_permissions"]["metadata"]["cleanupRegistered"] = False
        self.reject(data)

    def test_attempt_id_is_path_safe_and_distinguishes_same_sha_retries(self) -> None:
        first = fixture()
        second = fixture()
        second["attemptId"] = "attempt-2"
        second["checks"]["runtime.release_lock"]["metadata"]["attemptId"] = "attempt-2"
        self.assertNotEqual(validate(first, NOW)["receiptSha256"], validate(second, NOW)["receiptSha256"])
        for invalid in ("../attempt-2", "/attempt-2", "Attempt-2", "attempt 2", ""):
            data = fixture()
            data["attemptId"] = invalid
            self.reject(data)

        preactivate = fixture("preactivate")
        preactivate["attemptId"] = "attempt-2"
        self.reject(preactivate)

    def test_phase_and_build_started_cannot_be_crossed(self) -> None:
        data = fixture()
        data["buildStarted"] = True
        self.reject(data)
        data = fixture("preactivate")
        data["buildStarted"] = False
        self.reject(data)
        data = fixture()
        data["phase"] = {"prebuild": True}
        self.reject(data)

    def test_failed_check_remains_blocker(self) -> None:
        data = fixture()
        data["checks"]["network.dependencies"].update(status="failed", code="NETWORK_UNAVAILABLE")
        self.assertEqual(validate(data, NOW)["blockers"], [{"check": "network.dependencies", "code": "NETWORK_UNAVAILABLE"}])

    def test_preactivate_requires_matching_live_prebuild(self) -> None:
        data = fixture("preactivate")
        del data["prebuildEvidence"]
        self.reject(data)
        for field, bad in [("attemptId", "other"), ("sourceSha", "f" * 40), ("baselineSha", "f" * 40), ("release", "2026.9.15-cn.3")]:
            data = fixture("preactivate")
            data["prebuildEvidence"][field] = bad
            data["prebuildReceiptSha256"] = receipt_hash(data["prebuildEvidence"])
            self.reject(data)
        data = fixture("preactivate")
        data["prebuildReceiptSha256"] = "f" * 64
        self.reject(data)

    def test_expired_or_failed_prebuild_cannot_activate(self) -> None:
        data = fixture("preactivate")
        data["prebuildEvidence"]["expiresAt"] = "2026-09-15T12:59:59Z"
        data["prebuildReceiptSha256"] = receipt_hash(data["prebuildEvidence"])
        self.reject(data)
        data = fixture("preactivate")
        data["prebuildEvidence"]["checks"]["network.dependencies"].update(status="failed", code="NETWORK_UNAVAILABLE")
        data["prebuildReceiptSha256"] = receipt_hash(data["prebuildEvidence"])
        self.reject(data)

    def test_receipt_ttl_and_order_are_bounded(self) -> None:
        data = fixture()
        data["expiresAt"] = "2026-09-15T15:00:00Z"
        self.reject(data)
        data = fixture("preactivate")
        data["issuedAt"] = "2026-09-15T12:54:00Z"
        self.reject(data)


if __name__ == "__main__":
    unittest.main()
