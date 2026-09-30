#!/usr/bin/env python3
"""Fail-closed validator for the WorkspaceX CN aggregate release preflight."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path, PurePosixPath

HEX40 = re.compile(r"^[a-f0-9]{40}$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
UTC_TIME = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
RELEASE = re.compile(r"^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$")
ATTEMPT_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")

REQUIRED = {
    "source.exact_sha",
    "source.complete_artifact",
    "source.offline_plan_b",
    "toolchain.package_manager",
    "toolchain.pnpm_cli_protocol",
    "toolchain.stdout_protocol",
    "toolchain.browser_runtime",
    "registry.acr_auth",
    "runtime.release_lock",
    "runtime.no_orphans",
    "config.release_manifest",
    "config.durable_profiles",
    "config.secret_serialization",
    "cloud.managed_data_permissions",
    "database.drain_read_access",
    "bootstrap.compatibility",
    "secrets.stable_continuity",
    "build.affected_services",
    "deploy.trusted_copy",
    "network.dependencies",
}
POSTBUILD_ONLY = {"build.target_images"}
SERVICES = {"api", "web", "agent", "sandbox"}
MANAGED_DATA_DESCRIBE_ACTIONS = {
    "rds:DescribeDBInstanceAttribute",
    "rds:DescribeDBInstanceSSL",
    "rds:DescribeDBInstanceIPArrayList",
    "rds:DescribeBackupPolicy",
    "redis:DescribeInstanceAttribute",
    "redis:DescribeInstanceSSL",
}
BOOTSTRAP_FAILURE_CODES = {
    "BOOTSTRAP_IMAGE_INCOMPATIBLE",
    "BOOTSTRAP_INPUT_INVALID",
    "BOOTSTRAP_DB_SCHEMA_INCOMPATIBLE",
    "BOOTSTRAP_DB_PERMISSION_INCOMPATIBLE",
    "BOOTSTRAP_STATE_CONFLICT",
    "BOOTSTRAP_EXISTING_ADMIN_MISMATCH",
    "BOOTSTRAP_AGENT_SEED_INCOMPATIBLE",
    "BOOTSTRAP_READ_ONLY_GUARD_FAILED",
    "BOOTSTRAP_MACHINE_OUTPUT_INVALID",
    "BOOTSTRAP_PROBE_TIMEOUT",
    "BOOTSTRAP_PROBE_CLEANUP_UNPROVEN",
    "BOOTSTRAP_COMPATIBILITY_UNKNOWN",
}
BOOTSTRAP_SAFE_METADATA_KEYS = {
    "readOnlyTransaction",
    "productionWriteStatements",
    "imageEntrypoint",
    "sourceEntrypoint",
    "inputContract",
    "schemaContract",
    "permissionContract",
    "stateClass",
    "agentSeedContract",
    "exactlyOneMachineRecord",
    "emailSha256",
    "failedFieldIds",
    "missingObjectIds",
    "permissionIds",
    "templateIds",
    "durationMs",
    "budgetMs",
    "correlationId",
}
STABLE_SECRET_FAILURE_CODES = {
    "STABLE_SECRET_DIRECTORY_VERSION_SCOPED",
    "STABLE_SECRET_SET_MISMATCH",
    "STABLE_SECRET_MISSING",
    "STABLE_SECRET_ROTATION_DETECTED",
    "STABLE_SECRET_UNSAFE_PATH",
    "STABLE_SECRET_READ_UNPROVEN",
    "STABLE_SECRET_CONSUMER_DRIFT",
    "STABLE_SECRET_CONTINUITY_UNKNOWN",
}
STABLE_SECRET_SAFE_METADATA_KEYS = {
    "requiredCount",
    "matchedCount",
    "missingKeyIds",
    "rotatedKeyIds",
    "consumerDriftIds",
    "stableDirectory",
    "baselineReadable",
    "candidateWillReuse",
    "noMutation",
    "correlationId",
}


class ContractError(ValueError):
    pass


def need(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def metadata(checks: dict, key: str) -> dict:
    value = checks[key].get("metadata", {})
    need(isinstance(value, dict), f"{key}.metadata must be an object")
    return value


def safe_metadata(checks: dict, key: str, allowed: set[str]) -> dict:
    value = metadata(checks, key)
    need(set(value) <= allowed, f"{key}.metadata contains a non-redacted key")
    return value


def receipt_hash(value: dict) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()


def utc_timestamp(value: object, field: str) -> datetime:
    need(isinstance(value, str) and UTC_TIME.fullmatch(value) is not None, f"{field} must be UTC second-resolution ISO 8601")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise ContractError(f"{field} is not a real UTC time") from error


def validate(value: object, now: datetime | None = None) -> dict:
    need(isinstance(value, dict), "root must be an object")
    need(value.get("schemaVersion") == 2, "schemaVersion must be 2")
    phase = value.get("phase")
    need(isinstance(phase, str) and phase in {"prebuild", "preactivate"}, "phase must be prebuild or preactivate")
    need(isinstance(value.get("attemptId"), str) and ATTEMPT_ID.fullmatch(value["attemptId"]) is not None, "attemptId must be a path-safe lowercase identifier")
    for field in ("sourceSha", "baselineSha"):
        need(isinstance(value.get(field), str) and HEX40.fullmatch(value[field]) is not None, f"{field} must be 40 lowercase hex")
    need(isinstance(value.get("release"), str) and RELEASE.fullmatch(value["release"]) is not None, "release must be semantic")
    need(value.get("buildStarted") is (phase == "preactivate"), "buildStarted must match the declared phase")
    current = now if now is not None else datetime.now(timezone.utc)
    need(current.tzinfo is not None, "validator clock must be timezone-aware")
    issued = utc_timestamp(value.get("issuedAt"), "issuedAt")
    expires = utc_timestamp(value.get("expiresAt"), "expiresAt")
    need(issued <= current + timedelta(minutes=5), "receipt issued in the future")
    need(issued <= current < expires, "receipt is expired or not yet valid")
    need(timedelta(seconds=0) < expires - issued <= timedelta(hours=1), "receipt TTL must be at most one hour")
    if phase == "prebuild":
        need("prebuildEvidence" not in value and "prebuildReceiptSha256" not in value, "prebuild cannot contain prior receipt evidence")
    else:
        prior = value.get("prebuildEvidence")
        need(isinstance(prior, dict), "preactivate requires the full prebuild evidence")
        need(prior.get("phase") == "prebuild", "prior evidence must be prebuild")
        need(isinstance(value.get("prebuildReceiptSha256"), str) and HEX64.fullmatch(value["prebuildReceiptSha256"]) is not None, "prebuild receipt hash is required")
        need(receipt_hash(prior) == value["prebuildReceiptSha256"], "prebuild receipt hash differs")
        for field in ("attemptId", "sourceSha", "baselineSha", "release"):
            need(prior.get(field) == value[field], f"prebuild {field} differs")
        prior_result = validate(prior, current)
        need(prior_result["ready"] is True, "prebuild receipt was not ready")
        need(utc_timestamp(prior["issuedAt"], "prebuild issuedAt") <= issued, "preactivate precedes prebuild")

    checks = value.get("checks")
    need(isinstance(checks, dict), "checks must be an object")
    keys = set(checks)
    required = REQUIRED | (POSTBUILD_ONLY if phase == "preactivate" else set())
    need(keys == required, f"check ids differ; missing={sorted(required-keys)} unknown={sorted(keys-required)}")

    blockers = []
    for key in sorted(required):
        check = checks[key]
        need(isinstance(check, dict), f"{key} must be an object")
        need(check.get("status") in {"passed", "failed"}, f"{key}.status must be passed or failed")
        need(isinstance(check.get("evidenceSha256"), str) and HEX64.fullmatch(check["evidenceSha256"]) is not None, f"{key}.evidenceSha256 must be 64 lowercase hex")
        if check["status"] == "failed":
            need(isinstance(check.get("code"), str) and check["code"].strip(), f"{key}.code is required on failure")
            if key == "bootstrap.compatibility":
                need(check["code"] in BOOTSTRAP_FAILURE_CODES, "bootstrap.compatibility.code is not a stable allowlisted code")
            if key == "secrets.stable_continuity":
                need(check["code"] in STABLE_SECRET_FAILURE_CODES, "secrets.stable_continuity.code is not a stable allowlisted code")
            blockers.append({"check": key, "code": check["code"]})

    def if_passed(key: str, predicate: bool, message: str) -> None:
        if checks[key]["status"] == "passed":
            need(predicate, message)

    exact = safe_metadata(checks, "source.exact_sha", {"requestedSha", "repositoryHead", "mirrorHead"})
    if_passed(
        "source.exact_sha",
        exact.get("requestedSha") == value["sourceSha"]
        and exact.get("repositoryHead") == value["sourceSha"]
        and exact.get("mirrorHead") == value["sourceSha"],
        "requested, repository and offline mirror source SHAs must be exact",
    )
    complete = metadata(checks, "source.complete_artifact")
    if_passed("source.complete_artifact", complete.get("complete") is True and complete.get("offline") is True, "source artifact must be complete and offline")
    plan_b = metadata(checks, "source.offline_plan_b")
    if_passed("source.offline_plan_b", plan_b.get("githubRequired") is False, "offline Plan B must not require GitHub")
    package = metadata(checks, "toolchain.package_manager")
    if_passed("toolchain.package_manager", package.get("declared") == "pnpm@9.15.0" and package.get("actual") == "9.15.0", "pnpm must resolve exactly to packageManager pnpm@9.15.0")
    if_passed("toolchain.pnpm_cli_protocol", metadata(checks, "toolchain.pnpm_cli_protocol").get("doubleDashForwardingPassed") is True, "pnpm CLI forwarding counterproof did not pass")
    if_passed("toolchain.stdout_protocol", metadata(checks, "toolchain.stdout_protocol").get("exactlyOneMachineRecord") is True, "machine stdout protocol is unproved")
    browser = safe_metadata(checks, "toolchain.browser_runtime", {"browserExecutable", "playwrightResolved", "launchPassed"})
    browser_executable = browser.get("browserExecutable")
    browser_ok = (
        isinstance(browser_executable, str)
        and "\x00" not in browser_executable
        and PurePosixPath(browser_executable).is_absolute()
        and browser.get("playwrightResolved") is True
        and browser.get("launchPassed") is True
    )
    if_passed("toolchain.browser_runtime", browser_ok, "absolute browser executable, Playwright resolution and launch must all be proved")
    auth = metadata(checks, "registry.acr_auth")
    if_passed("registry.acr_auth", auth.get("authenticatedProbe") is True, "ACR authenticated probe is required")
    if_passed("registry.acr_auth", isinstance(auth.get("remainingTtlSeconds"), int) and auth["remainingTtlSeconds"] >= 1800, "ACR credential TTL must be at least 1800 seconds")
    lock = safe_metadata(checks, "runtime.release_lock", {"heldByAttempt", "attemptId"})
    if_passed("runtime.release_lock", lock.get("heldByAttempt") is True and lock.get("attemptId") == value["attemptId"], "release lock must be held by this exact attempt")
    orphans = safe_metadata(checks, "runtime.no_orphans", {"scanPassed", "count"})
    if_passed("runtime.no_orphans", orphans.get("scanPassed") is True and orphans.get("count") == 0, "orphan release process scan must pass with count zero")
    identity = safe_metadata(checks, "config.release_manifest", {"sourceSha", "release", "kind", "imageDigest", "imageDigests"})
    identity_ok = identity.get("sourceSha") == value["sourceSha"] and identity.get("release") == value["release"]
    if phase == "prebuild":
        identity_ok = identity_ok and identity.get("kind") == "source-plan" and "imageDigest" not in identity and "imageDigests" not in identity
    else:
        target_metadata = safe_metadata(checks, "build.target_images", {"services"})
        targets = target_metadata.get("services")
        targets_ok = isinstance(targets, dict) and set(targets) == SERVICES
        if targets_ok:
            for service in SERVICES:
                target = targets[service]
                targets_ok = (
                    isinstance(target, dict)
                    and set(target) <= {"sourceSha", "digest", "entrypointVerified"}
                    and target.get("sourceSha") == value["sourceSha"]
                    and isinstance(target.get("digest"), str)
                    and DIGEST.fullmatch(target["digest"]) is not None
                    and target.get("entrypointVerified") is True
                )
                if not targets_ok:
                    break
        if_passed("build.target_images", targets_ok, "all four target image digests, source identities and entrypoints must be proved")
        manifest_digests = identity.get("imageDigests")
        identity_ok = (
            identity_ok
            and identity.get("kind") == "sealed-images"
            and isinstance(manifest_digests, dict)
            and set(manifest_digests) == SERVICES
            and targets_ok
            and all(manifest_digests[service] == targets[service]["digest"] for service in SERVICES)
        )
    if_passed("config.release_manifest", identity_ok, "config/manifest release identity or stage differs")
    durable = safe_metadata(checks, "config.durable_profiles", {"asrConfigured", "githubIssueConfigured", "platformSuperuserConfigured"})
    durable_ok = (
        durable.get("asrConfigured") is True
        and durable.get("githubIssueConfigured") is True
        and durable.get("platformSuperuserConfigured") is True
    )
    if_passed("config.durable_profiles", durable_ok, "ASR, GitHub issue and platform superuser durable profiles must be proved")
    secrets = metadata(checks, "config.secret_serialization")
    if_passed("config.secret_serialization", isinstance(secrets.get("checkedRefs"), int) and secrets["checkedRefs"] > 0 and secrets.get("invalidKeys") == [], "all secret refs and runtime env maps must pass serialization")
    managed = safe_metadata(
        checks,
        "cloud.managed_data_permissions",
        {"mode", "liveDescribePassed", "passedActions", "temporaryPolicyExpires", "cleanupRegistered", "resourceScoped", "readOnlyActionsOnly"},
    )
    passed_actions = managed.get("passedActions")
    live_describes_ok = (
        managed.get("liveDescribePassed") is True
        and isinstance(passed_actions, list)
        and all(isinstance(action, str) for action in passed_actions)
        and len(passed_actions) == len(set(passed_actions))
        and set(passed_actions) == MANAGED_DATA_DESCRIBE_ACTIONS
    )
    permission_mode = managed.get("mode")
    temporary_ok = (
        permission_mode == "temporary-policy"
        and managed.get("temporaryPolicyExpires") is True
        and managed.get("cleanupRegistered") is True
    )
    persistent_ok = (
        permission_mode == "persistent-resource-scoped-read-only"
        and managed.get("resourceScoped") is True
        and managed.get("readOnlyActionsOnly") is True
    )
    if_passed("cloud.managed_data_permissions", live_describes_ok and (temporary_ok or persistent_ok), "six live Describe actions and one bounded permission mode must be proved")
    drain = metadata(checks, "database.drain_read_access")
    if_passed("database.drain_read_access", drain.get("role") == "app_diag_ro" and drain.get("canReadAgentRuns") is True, "app_diag_ro drain read is unproved")
    bootstrap = metadata(checks, "bootstrap.compatibility")
    need(set(bootstrap) <= BOOTSTRAP_SAFE_METADATA_KEYS, "bootstrap.compatibility.metadata contains a non-redacted key")
    bootstrap_ok = (
        bootstrap.get("readOnlyTransaction") is True
        and bootstrap.get("productionWriteStatements") == 0
        and bootstrap.get("sourceEntrypoint" if phase == "prebuild" else "imageEntrypoint") is True
        and bootstrap.get("inputContract") is True
        and bootstrap.get("schemaContract") is True
        and bootstrap.get("permissionContract") is True
        and bootstrap.get("stateClass") in {"empty", "matching-existing"}
        and bootstrap.get("agentSeedContract") is True
        and bootstrap.get("exactlyOneMachineRecord") is True
    )
    if_passed("bootstrap.compatibility", bootstrap_ok, "bootstrap compatibility is unproved or not read-only")
    if phase == "prebuild":
        need("imageEntrypoint" not in bootstrap, "prebuild must not claim a target image entrypoint")
    else:
        need("sourceEntrypoint" not in bootstrap, "preactivate must use the built image entrypoint")
    continuity = metadata(checks, "secrets.stable_continuity")
    need(set(continuity) <= STABLE_SECRET_SAFE_METADATA_KEYS, "secrets.stable_continuity.metadata contains a non-redacted key")
    continuity_ok = (
        continuity.get("requiredCount") == 12
        and continuity.get("matchedCount") == 12
        and continuity.get("missingKeyIds") == []
        and continuity.get("rotatedKeyIds") == []
        and continuity.get("consumerDriftIds", []) == []
        and continuity.get("stableDirectory") is True
        and continuity.get("baselineReadable") is True
        and continuity.get("candidateWillReuse") is True
        and continuity.get("noMutation") is True
    )
    if_passed("secrets.stable_continuity", continuity_ok, "all 12 stable deployment secrets must be reused without mutation")
    affected_metadata = safe_metadata(checks, "build.affected_services", {"diffComputed", "baselineSha", "sourceSha", "services"})
    affected = affected_metadata.get("services")
    affected_ok = (
        affected_metadata.get("diffComputed") is True
        and affected_metadata.get("baselineSha") == value["baselineSha"]
        and affected_metadata.get("sourceSha") == value["sourceSha"]
        and isinstance(affected, list)
        and all(isinstance(service, str) for service in affected)
        and len(affected) == len(set(affected))
        and set(affected) <= SERVICES
    )
    if_passed("build.affected_services", affected_ok, "affected services must come from the exact baseline-to-source diff")
    trusted = safe_metadata(checks, "deploy.trusted_copy", {"hashesMatch", "checkedEntrypoints"})
    trusted_ok = trusted.get("hashesMatch") is True and isinstance(trusted.get("checkedEntrypoints"), int) and trusted["checkedEntrypoints"] > 0
    if_passed("deploy.trusted_copy", trusted_ok, "trusted entrypoint hashes must be compared against the candidate")
    network = safe_metadata(checks, "network.dependencies", {"probed", "acr", "oss", "rds", "redis"})
    network_ok = network.get("probed") is True and all(network.get(name) is True for name in ("acr", "oss", "rds", "redis"))
    if_passed("network.dependencies", network_ok, "ACR, OSS, RDS and Redis live network probes must all pass")

    return {
        "schemaVersion": 2,
        "phase": phase,
        "attemptId": value["attemptId"],
        "sourceSha": value["sourceSha"],
        "baselineSha": value["baselineSha"],
        "release": value["release"],
        "issuedAt": value["issuedAt"],
        "expiresAt": value["expiresAt"],
        "receiptSha256": receipt_hash(value),
        "ready": not blockers,
        "buildStarted": value["buildStarted"],
        "blockers": blockers,
        "checkedCount": len(required),
    }


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate_preflight.py <preflight.json>", file=sys.stderr)
        return 2
    try:
        raw = Path(sys.argv[1]).read_text(encoding="utf-8")
        result = validate(json.loads(raw))
    except (OSError, json.JSONDecodeError, ContractError) as error:
        print(f"CN_RELEASE_PREFLIGHT_INVALID: {error}", file=sys.stderr)
        return 2
    print("CN_RELEASE_PREFLIGHT_JSON=" + json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
