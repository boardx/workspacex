#!/usr/bin/env python3
"""Read-only scenario planning and bounded offline release regression entrypoint.

This never admits a release: canonical prepare/activation validators retain that
authority. It does not contact providers, read credentials, or download images.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
SHA = re.compile(r"[a-f0-9]{40}")
COMMON = ["exact-source", "prebuild", "artifact-seal", "offline-prepare",
          "preactivate", "baseline-cas", "activate", "public-business"]
# These are conservative change detectors, NOT an alternative migration authority.
DB_PATHS = ("apps/api/migrations/", "apps/api/src/infrastructure/db/",
            "apps/api/scripts/bootstrap", "packages/db/")
DB_FILES = {"apps/deep-agent-service/uv.lock", "apps/deep-agent-service/pyproject.toml",
            "pnpm-lock.yaml", "package.json"}
SUITES = {
    "scenario": [["-m", "unittest", "discover", "-s", "tests", "-p", "test_cn_release_audit.py", "-v"]],
    "artifact": [["-m", "unittest", "discover", "-s", "tests", "-p", pattern, "-v"] for pattern in
                 ("test_cn_image_candidate.py", "test_cn_repeated_layers.py", "test_cn_formal_save_bound.py")],
    "transport": [["tests/test_cn_hk_original_artifact_upload.py"], ["tests/test_cn_hk_proof_integration.py"]],
    "host": [["-m", "unittest", "discover", "-s", "tests", "-p", pattern, "-v"] for pattern in
             ("test_cn_candidate_publication.py", "test_cn_candidate_host.py")],
    "recovery": [[".harness/scripts/vm/cn_maintenance_hold_test.py"],
                 [".harness/scripts/vm/cn_release_hold_integration_test.py"],
                 ["-m", "unittest", "discover", "-s", "tests", "-p", "test_release_failure_matrix.py", "-v"]],
}


def need(condition, code):
    if not condition:
        raise ValueError(code)


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def read_json(path):
    raw = path.read_bytes()
    need(len(raw) <= 1024 * 1024, "INPUT_TOO_LARGE")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, "DUPLICATE_KEY")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def timestamp(value):
    need(isinstance(value, str), "TIME_INVALID")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    need(parsed.tzinfo is not None, "TIME_ZONE_REQUIRED")
    return parsed


def git(repo, *args):
    # No shell, hooks, lazy object acquisition, external diff, or moving refs.
    env = dict(os.environ, GIT_NO_LAZY_FETCH="1", GIT_TERMINAL_PROMPT="0")
    result = subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-C", str(repo), *args],
                            env=env, capture_output=True, timeout=30)
    need(result.returncode == 0, "OFFLINE_SOURCE_UNAVAILABLE")
    return result.stdout


def source_diff(repo, baseline, source, recovery=False):
    need(all(isinstance(s, str) and SHA.fullmatch(s) for s in (baseline, source)), "EXACT_SHA_REQUIRED")
    for sha in (baseline, source):
        need(git(repo, "rev-parse", sha + "^{commit}").decode().strip() == sha, "COMMIT_REQUIRED")
    if not recovery:
        git(repo, "merge-base", "--is-ancestor", baseline, source)
    raw = git(repo, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", baseline, source, "--")
    paths = [p.decode("utf8", errors="strict") for p in raw.split(b"\0") if p]
    need(len(paths) <= 20000, "DIFF_TOO_LARGE")
    return paths, hashlib.sha256(raw).hexdigest()


def classify(repo, value):
    fields = {"schemaVersion", "sourceSha", "baselineSha", "urgency", "productionHealthy",
              "changeKind", "migrationRisk", "infrastructureChanged", "stableSecretsChanged",
              "artifactState", "preparedState"}
    need(isinstance(value, dict) and set(value) == fields and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1, "REQUEST_SCHEMA_INVALID")
    for field in ("productionHealthy", "infrastructureChanged", "stableSecretsChanged"):
        need(type(value[field]) is bool, "BOOLEAN_REQUIRED")
    for field, choices in {"urgency": {"normal", "hotfix"}, "changeKind": {"code", "config", "seed"},
                           "migrationRisk": {"none", "additive", "destructive", "unknown"},
                           "artifactState": {"missing", "sealed"},
                           "preparedState": {"missing", "valid", "expired", "drifted"}}.items():
        need(value[field] in choices, "REQUEST_ENUM_INVALID")
    paths, digest = source_diff(repo, value["baselineSha"], value["sourceSha"], recovery=not value["productionHealthy"])
    db_paths = [p for p in paths if p.startswith(DB_PATHS) or p in DB_FILES or
                p.endswith(".sql") or re.search(r"(^|/)(migrations?|schemas?)(/|\.)", p, re.I)]
    # A claimed no-migration shortcut never wins over observed source changes.
    risk = value["migrationRisk"]
    if db_paths and risk == "none":
        risk = "unknown"
    need(value["changeKind"] == "code" or not paths, "CONFIG_SEED_CANNOT_HIDE_CODE_CHANGE")
    if not value["productionHealthy"]:
        scenario, budget = "recovery", 300
        gates = ["baseline-closure", "rollback", "rollback-public-business"]
    elif risk in {"unknown", "destructive"} or value["infrastructureChanged"] or value["stableSecretsChanged"]:
        scenario, budget = "maintenance", None
        gates = ["maintenance-approval", "restore-rehearsal", "current-epoch-backup", "migration-readback", *COMMON]
    elif value["changeKind"] in {"config", "seed"} and risk == "none":
        scenario, budget = "config-seed", 600
        gates = ["baseline-cas", "config-snapshot", "idempotence", "config-seed-apply", "public-business"]
    elif value["preparedState"] == "valid" and value["artifactState"] == "sealed":
        scenario, budget = "prepared", 300
        gates = ["canonical-prepared-verifier", "preactivate", "baseline-cas", "activate", "public-business"]
    elif value["artifactState"] == "sealed":
        scenario, budget = "artifact-ready", 900
        gates = list(COMMON)
    else:
        scenario, budget = "cold", 1800
        gates = ["exact-source", "prebuild", "build-affected", "artifact-seal", "hk-transfer", *COMMON[3:]]
    if risk == "additive" and scenario not in {"recovery", "maintenance"}:
        gates.insert(gates.index("preactivate"), "migration-backup-rehearsal-readback")
    return {"schemaVersion": 1, "kind": "cn-release-scenario-plan", "sourceSha": value["sourceSha"],
            "baselineSha": value["baselineSha"], "scenario": scenario, "urgency": value["urgency"],
            "migrationRisk": risk, "databaseSensitivePaths": db_paths, "changedPaths": paths,
            "diffSha256": digest, "requiredGates": gates, "scenarioPlanningSeconds": budget,
            "requestedCalendarTargetSeconds": 1800, "thirtyMinuteEligible": scenario != "maintenance",
            "planningOnly": True, "admissionReady": False, "productionActivated": False,
            "notes": ["Hotfix changes priority, never removes gates.",
                      "No migration file change does not prove absence of startup cleanup, seeds, or workers.",
                      "Prepared/sealed input is a claim; canonical validators must verify live bindings and TTL."]}


def timeline(value):
    """Check measured event structure, never mint a production acceptance receipt."""
    need(isinstance(value, dict) and set(value) == {"schemaVersion", "attemptId", "sourceSha", "scenario", "requestedAt", "events"}, "TIMELINE_SCHEMA_INVALID")
    need(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and isinstance(value["sourceSha"], str) and SHA.fullmatch(value["sourceSha"]), "EXACT_SHA_REQUIRED")
    need(isinstance(value["attemptId"], str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,99}", value["attemptId"]), "ATTEMPT_INVALID")
    need(value["scenario"] in {"recovery", "maintenance", "config-seed", "prepared", "artifact-ready", "cold"}, "SCENARIO_INVALID")
    rows = value["events"]
    need(isinstance(rows, list) and 3 <= len(rows) <= 100, "EVENTS_INVALID")
    start = timestamp(value["requestedAt"])
    previous = start
    names = []
    for row in rows:
        need(isinstance(row, dict) and set(row) == {"name", "at", "sourceSha", "attemptId", "evidenceSha256", "status"}, "EVENT_INVALID")
        need(row["sourceSha"] == value["sourceSha"] and row["attemptId"] == value["attemptId"], "EVENT_IDENTITY_MISMATCH")
        need(row["status"] == "passed", "EVENT_NOT_PASSED")
        need(isinstance(row["name"], str) and re.fullmatch(r"[a-z][a-z0-9_.-]{0,63}", row["name"]), "EVENT_NAME_INVALID")
        need(row["name"] not in names, "DUPLICATE_EVENT")
        need(isinstance(row["evidenceSha256"], str) and re.fullmatch(r"[a-f0-9]{64}", row["evidenceSha256"]), "EVIDENCE_HASH_REQUIRED")
        current = timestamp(row["at"])
        need(previous <= current, "EVENT_TIME_REVERSED")
        previous = current
        names.append(row["name"])
    required = ["runner.started", "runtime.identity", "public.business"]
    if value["scenario"] in {"cold", "artifact-ready", "prepared", "maintenance"}:
        required = ["runner.started", "preactivate.passed", "activation.started", "runtime.identity", "public.business"]
    if value["scenario"] == "cold":
        required[1:1] = ["build.sealed", "hk.readback", "shanghai.admitted"]
    elif value["scenario"] == "artifact-ready":
        required[1:1] = ["shanghai.admitted"]
    if value["scenario"] == "maintenance":
        required[1:1] = ["backup.verified", "migration.readback"]
    if value["scenario"] == "recovery":
        required[1:1] = ["rollback.restored"]
    if value["scenario"] == "config-seed":
        required[1:1] = ["config.snapshot", "config.applied"]
    need(all(name in names for name in required), "END_TO_END_EVENTS_MISSING")
    need([names.index(n) for n in required] == sorted(names.index(n) for n in required), "STAGE_ORDER_INVALID")
    event = {r["name"]: timestamp(r["at"]) for r in rows}
    finish = event["public.business"]
    need(names[-1] == "public.business", "ACCEPTANCE_MUST_BE_FINAL")
    calendar = (finish - start).total_seconds()
    execution = (finish - event["runner.started"]).total_seconds()
    activation = (finish - event["activation.started"]).total_seconds() if "activation.started" in event else None
    return {"kind": "cn-release-timing-audit", "timelineStructurallyValid": True,
            "calendarSeconds": calendar, "executionSeconds": execution,
            "queueAndApprovalSeconds": (event["runner.started"] - start).total_seconds(),
            "activationSeconds": activation, "calendarTargetMet": calendar <= 1800,
            "activationTargetMet": activation is None or activation <= 300,
            "evidenceContentsVerified": False, "productionAvailable": False,
            "note": "Hashes and timestamps are assertions. Independently verify original provider/runtime/browser evidence before acceptance."}


def run_suite(name, total_seconds):
    need(1 <= total_seconds <= 1800, "TEST_BUDGET_INVALID")
    groups = list(SUITES) if name == "all" else [name]
    started = time.monotonic()
    rows = []
    for group in groups:
        for args in SUITES[group]:
            remaining = total_seconds - (time.monotonic() - started)
            if remaining <= 0:
                rows.append({"group": group, "test": args[-1] if args[-1] != "-v" else args[-2], "status": "not-run-budget-exhausted"})
                continue
            # Tests require no provider identity; do not inherit identity merely
            # because the test suite currently mocks a cloud boundary.
            env = {k: v for k, v in os.environ.items() if k in {"PATH", "HOME", "TMPDIR", "TEMP", "TMP", "CN_ARCHIVE_TEST_NODE", "CN_ARCHIVE_TEST_RUNTIME"}}
            with tempfile.TemporaryFile() as output:
                process = subprocess.Popen([sys.executable, "-B", *args], cwd=ROOT, env=env,
                                           stdout=output, stderr=output, start_new_session=True)
                try:
                    code = process.wait(timeout=min(remaining, 300))
                    status = "passed" if code == 0 else "failed"
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                    status = "timeout"
                output.seek(0)
                raw = output.read()
            # unittest returns exit 0 for zero discovered tests and all-skipped
            # suites; neither establishes the contract this entrypoint claims.
            counts = re.findall(rb"Ran (\d+) tests? in", raw)
            skipped = re.search(rb"\bskipped=[1-9][0-9]*", raw) is not None
            if status == "passed" and (skipped or counts and int(counts[-1]) == 0):
                status = "incomplete"
            rows.append({"group": group, "argv": args, "status": status,
                         "testsRun": int(counts[-1]) if counts else None,
                         "outputSha256": hashlib.sha256(raw).hexdigest()})
    return {"kind": "cn-release-offline-regression", "passed": all(r["status"] == "passed" for r in rows),
            "durationSeconds": round(time.monotonic() - started, 3), "results": rows,
            "cloudEndToEndTested": False, "productionActivated": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    classify_parser = commands.add_parser("classify")
    classify_parser.add_argument("--repo", type=Path, default=ROOT)
    classify_parser.add_argument("request", type=Path)
    commands.add_parser("timeline").add_argument("request", type=Path)
    suite = commands.add_parser("test")
    suite.add_argument("--suite", choices=["all", *SUITES], default="all")
    suite.add_argument("--budget-seconds", type=int, default=900)
    args = parser.parse_args()
    try:
        if args.command == "classify":
            result = classify(args.repo, read_json(args.request))
        elif args.command == "timeline":
            result = timeline(read_json(args.request))
        else:
            result = run_suite(args.suite, args.budget_seconds)
        print(json_bytes(result).decode(), end="")
        return 1 if args.command == "test" and not result["passed"] else 0
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
        # Unknown source/provider text never crosses the public error boundary.
        print(json.dumps({"ok": False, "code": "CN_RELEASE_AUDIT_REJECTED", "productionActivated": False}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
