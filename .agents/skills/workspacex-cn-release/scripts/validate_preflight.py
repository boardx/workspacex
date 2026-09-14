#!/usr/bin/env python3
"""Fail-closed validator for the WorkspaceX CN aggregate release preflight."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HEX40 = re.compile(r"^[a-f0-9]{40}$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
RELEASE = re.compile(r"^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$")

REQUIRED = {
    "source.exact_sha",
    "source.complete_artifact",
    "source.offline_plan_b",
    "toolchain.package_manager",
    "toolchain.pnpm_cli_protocol",
    "toolchain.stdout_protocol",
    "registry.acr_auth",
    "runtime.release_lock",
    "runtime.no_orphans",
    "config.release_manifest",
    "config.durable_profiles",
    "config.secret_serialization",
    "cloud.managed_data_permissions",
    "database.drain_read_access",
    "build.affected_services",
    "deploy.trusted_copy",
    "network.dependencies",
}
SERVICES = {"api", "web", "agent", "sandbox"}


class ContractError(ValueError):
    pass


def need(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def metadata(checks: dict, key: str) -> dict:
    value = checks[key].get("metadata", {})
    need(isinstance(value, dict), f"{key}.metadata must be an object")
    return value


def validate(value: object) -> dict:
    need(isinstance(value, dict), "root must be an object")
    need(value.get("schemaVersion") == 1, "schemaVersion must be 1")
    need(isinstance(value.get("attemptId"), str) and value["attemptId"].strip(), "attemptId is required")
    for field in ("sourceSha", "baselineSha"):
        need(isinstance(value.get(field), str) and HEX40.fullmatch(value[field]) is not None, f"{field} must be 40 lowercase hex")
    need(isinstance(value.get("release"), str) and RELEASE.fullmatch(value["release"]) is not None, "release must be semantic")
    need(value.get("buildStarted") is False, "aggregate preflight must run before build_started")

    checks = value.get("checks")
    need(isinstance(checks, dict), "checks must be an object")
    keys = set(checks)
    need(keys == REQUIRED, f"check ids differ; missing={sorted(REQUIRED-keys)} unknown={sorted(keys-REQUIRED)}")

    blockers = []
    for key in sorted(REQUIRED):
        check = checks[key]
        need(isinstance(check, dict), f"{key} must be an object")
        need(check.get("status") in {"passed", "failed"}, f"{key}.status must be passed or failed")
        need(isinstance(check.get("evidenceSha256"), str) and HEX64.fullmatch(check["evidenceSha256"]) is not None, f"{key}.evidenceSha256 must be 64 lowercase hex")
        if check["status"] == "failed":
            need(isinstance(check.get("code"), str) and check["code"].strip(), f"{key}.code is required on failure")
            blockers.append({"check": key, "code": check["code"]})

    def if_passed(key: str, predicate: bool, message: str) -> None:
        if checks[key]["status"] == "passed":
            need(predicate, message)

    complete = metadata(checks, "source.complete_artifact")
    if_passed("source.complete_artifact", complete.get("complete") is True and complete.get("offline") is True, "source artifact must be complete and offline")
    plan_b = metadata(checks, "source.offline_plan_b")
    if_passed("source.offline_plan_b", plan_b.get("githubRequired") is False, "offline Plan B must not require GitHub")
    package = metadata(checks, "toolchain.package_manager")
    if_passed("toolchain.package_manager", package.get("declared") == "pnpm@9.15.0" and package.get("actual") == "9.15.0", "pnpm must resolve exactly to packageManager pnpm@9.15.0")
    if_passed("toolchain.pnpm_cli_protocol", metadata(checks, "toolchain.pnpm_cli_protocol").get("doubleDashForwardingPassed") is True, "pnpm CLI forwarding counterproof did not pass")
    if_passed("toolchain.stdout_protocol", metadata(checks, "toolchain.stdout_protocol").get("exactlyOneMachineRecord") is True, "machine stdout protocol is unproved")
    auth = metadata(checks, "registry.acr_auth")
    if_passed("registry.acr_auth", auth.get("authenticatedProbe") is True, "ACR authenticated probe is required")
    if_passed("registry.acr_auth", isinstance(auth.get("remainingTtlSeconds"), int) and auth["remainingTtlSeconds"] >= 1800, "ACR credential TTL must be at least 1800 seconds")
    if_passed("runtime.release_lock", metadata(checks, "runtime.release_lock").get("heldByAttempt") is True, "release lock must be held by this attempt")
    if_passed("runtime.no_orphans", metadata(checks, "runtime.no_orphans").get("count") == 0, "orphan release process count must be zero")
    identity = metadata(checks, "config.release_manifest")
    if_passed("config.release_manifest", identity.get("sourceSha") == value["sourceSha"] and identity.get("release") == value["release"], "config/manifest release identity differs")
    secrets = metadata(checks, "config.secret_serialization")
    if_passed("config.secret_serialization", isinstance(secrets.get("checkedRefs"), int) and secrets["checkedRefs"] > 0 and secrets.get("invalidKeys") == [], "all secret refs and runtime env maps must pass serialization")
    managed = metadata(checks, "cloud.managed_data_permissions")
    if_passed("cloud.managed_data_permissions", managed.get("liveDescribePassed") is True and managed.get("temporaryPolicyExpires") is True and managed.get("cleanupRegistered") is True, "managed-data Describe permissions and bounded cleanup must be proved")
    drain = metadata(checks, "database.drain_read_access")
    if_passed("database.drain_read_access", drain.get("role") == "app_diag_ro" and drain.get("canReadAgentRuns") is True, "app_diag_ro drain read is unproved")
    affected = metadata(checks, "build.affected_services").get("services")
    if_passed("build.affected_services", isinstance(affected, list) and len(affected) == len(set(affected)) and set(affected) <= SERVICES, "affected services must be a unique subset of api/web/agent/sandbox")

    return {
        "schemaVersion": 1,
        "attemptId": value["attemptId"],
        "sourceSha": value["sourceSha"],
        "release": value["release"],
        "ready": not blockers,
        "buildStarted": False,
        "blockers": blockers,
        "checkedCount": len(REQUIRED),
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
