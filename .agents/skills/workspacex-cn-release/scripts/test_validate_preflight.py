#!/usr/bin/env python3
"""Counterexamples for stage-specific, fail-closed CN release evidence."""

from __future__ import annotations

import unittest

from validate_preflight import ContractError, REQUIRED, validate

SHA = "a" * 40
DIGEST = "sha256:" + "b" * 64


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
    return {"schemaVersion": 2, "phase": phase, "attemptId": "attempt-1", "sourceSha": SHA, "baselineSha": "e" * 40, "release": "2026.9.15-cn.2", "buildStarted": phase == "preactivate", "checks": checks}


class TestValidatePreflight(unittest.TestCase):
    def reject(self, data: dict) -> None:
        with self.assertRaises(ContractError):
            validate(data)

    def test_prebuild_without_image_is_ready_to_build(self) -> None:
        result = validate(fixture())
        self.assertTrue(result["ready"])
        self.assertFalse(result["buildStarted"])
        self.assertEqual(result["phase"], "prebuild")

    def test_preactivate_with_exact_sealed_image_is_ready(self) -> None:
        result = validate(fixture("preactivate"))
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
        self.assertEqual(validate(data)["blockers"], [{"check": "network.dependencies", "code": "NETWORK_UNAVAILABLE"}])


if __name__ == "__main__":
    unittest.main()
