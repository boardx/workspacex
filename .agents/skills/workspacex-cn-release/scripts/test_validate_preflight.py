#!/usr/bin/env python3
"""Counterexamples for stage-specific, fail-closed CN release evidence."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from validate_preflight import ContractError, REQUIRED, receipt_hash, validate

SHA = "a" * 40
DIGEST = "sha256:" + "b" * 64
NOW = datetime(2026, 9, 15, 13, 0, tzinfo=timezone.utc)


def fixture(phase: str = "prebuild") -> dict:
    checks = {key: {"status": "passed", "evidenceSha256": "c" * 64} for key in REQUIRED}
    checks["source.complete_artifact"]["metadata"] = {"complete": True, "offline": True}
    checks["source.offline_plan_b"]["metadata"] = {"githubRequired": False}
    checks["toolchain.package_manager"]["metadata"] = {"declared": "pnpm@9.15.0", "actual": "9.15.0"}
    checks["toolchain.pnpm_cli_protocol"]["metadata"] = {"doubleDashForwardingPassed": True}
    checks["toolchain.stdout_protocol"]["metadata"] = {"exactlyOneMachineRecord": True}
    checks["registry.acr_auth"]["metadata"] = {"authenticatedProbe": True, "remainingTtlSeconds": 3600}
    checks["runtime.release_lock"]["metadata"] = {"heldByAttempt": True}
    checks["runtime.no_orphans"]["metadata"] = {"count": 0}
    checks["config.release_manifest"]["metadata"] = {"sourceSha": SHA, "release": "2026.9.15-cn.2", "kind": "source-plan"}
    checks["config.secret_serialization"]["metadata"] = {"checkedRefs": 7, "invalidKeys": []}
    checks["cloud.managed_data_permissions"]["metadata"] = {"liveDescribePassed": True, "temporaryPolicyExpires": True, "cleanupRegistered": True}
    checks["database.drain_read_access"]["metadata"] = {"role": "app_diag_ro", "canReadAgentRuns": True}
    checks["bootstrap.compatibility"]["metadata"] = {"readOnlyTransaction": True, "productionWriteStatements": 0, "sourceEntrypoint": True, "inputContract": True, "schemaContract": True, "permissionContract": True, "stateClass": "matching-existing", "agentSeedContract": True, "exactlyOneMachineRecord": True}
    checks["secrets.stable_continuity"]["metadata"] = {"requiredCount": 12, "matchedCount": 12, "missingKeyIds": [], "rotatedKeyIds": [], "consumerDriftIds": [], "stableDirectory": True, "baselineReadable": True, "candidateWillReuse": True, "noMutation": True}
    checks["build.affected_services"]["metadata"] = {"services": ["api", "web"]}
    if phase == "preactivate":
        checks["config.release_manifest"]["metadata"].update(kind="sealed-image", imageDigest=DIGEST)
        boot = checks["bootstrap.compatibility"]["metadata"]
        boot.pop("sourceEntrypoint")
        boot["imageEntrypoint"] = True
        checks["build.target_image"] = {"status": "passed", "evidenceSha256": "d" * 64, "metadata": {"sourceSha": SHA, "digest": DIGEST, "entrypointVerified": True}}
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

    def test_prebuild_without_image_is_ready_to_build(self) -> None:
        result = validate(fixture(), NOW)
        self.assertTrue(result["ready"])
        self.assertFalse(result["buildStarted"])
        self.assertEqual(result["phase"], "prebuild")

    def test_preactivate_with_exact_sealed_image_is_ready(self) -> None:
        result = validate(fixture("preactivate"), NOW)
        self.assertTrue(result["ready"])
        self.assertEqual(result["checkedCount"], len(REQUIRED) + 1)

    def test_prebuild_cannot_claim_image_or_use_target_check(self) -> None:
        data = fixture()
        data["checks"]["bootstrap.compatibility"]["metadata"]["imageEntrypoint"] = True
        self.reject(data)
        data = fixture()
        data["checks"]["build.target_image"] = {"status": "passed", "evidenceSha256": "d" * 64}
        self.reject(data)

    def test_preactivate_requires_image_and_exact_identity(self) -> None:
        data = fixture("preactivate")
        del data["checks"]["build.target_image"]
        self.reject(data)
        for field, bad in [("sourceSha", "f" * 40), ("digest", "sha256:" + "f" * 64), ("entrypointVerified", False)]:
            data = fixture("preactivate")
            data["checks"]["build.target_image"]["metadata"][field] = bad
            self.reject(data)
        data = fixture("preactivate")
        data["checks"]["config.release_manifest"]["metadata"]["imageDigest"] = "sha256:" + "f" * 64
        self.reject(data)

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
