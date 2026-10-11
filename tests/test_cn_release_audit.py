"""Real git/CLI integration plus bounded process failure injection; no cloud."""
import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "scripts/cn-release-audit.py"
spec = importlib.util.spec_from_file_location("release_audit", ENTRY)
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


def request(base="a" * 40, source="b" * 40):
    return dict(schemaVersion=1, sourceSha=source, baselineSha=base, urgency="normal",
                productionHealthy=True, changeKind="code", migrationRisk="none",
                infrastructureChanged=False, stableSecretsChanged=False,
                artifactState="missing", preparedState="missing")


def timeline(scenario="cold", minutes=20):
    start = dt.datetime(2026, 10, 11, tzinfo=dt.timezone.utc)
    names = ["runner.started", "build.sealed", "hk.readback", "shanghai.admitted",
             "preactivate.passed", "activation.started", "runtime.identity", "public.business"]
    seconds = [60, 300, 600, 800, 900, 950, 1000, minutes * 60]
    return dict(schemaVersion=1, attemptId="integration-a", sourceSha="b" * 40,
                scenario=scenario, requestedAt=start.isoformat(), events=[dict(
                    name=name, at=(start + dt.timedelta(seconds=second)).isoformat(),
                    sourceSha="b" * 40, attemptId="integration-a", evidenceSha256="c" * 64,
                    status="passed") for name, second in zip(names, seconds)])


class Scenarios(unittest.TestCase):
    def plan(self, value, paths=()):
        with patch.object(a, "source_diff", return_value=(list(paths), "c" * 64)):
            return a.classify(ROOT, value)

    def test_all_six_sop_scenarios_and_priority(self):
        cases = [(dict(productionHealthy=False, migrationRisk="destructive"), "recovery"),
                 (dict(migrationRisk="unknown", preparedState="valid", artifactState="sealed"), "maintenance"),
                 (dict(stableSecretsChanged=True), "maintenance"),
                 (dict(infrastructureChanged=True), "maintenance"),
                 (dict(changeKind="config"), "config-seed"),
                 (dict(changeKind="seed"), "config-seed"),
                 (dict(preparedState="valid", artifactState="sealed"), "prepared"),
                 (dict(preparedState="expired", artifactState="sealed"), "artifact-ready"),
                 (dict(preparedState="drifted", artifactState="sealed"), "artifact-ready"),
                 ({}, "cold")]
        for changes, expected in cases:
            with self.subTest(changes=changes):
                v = request(); v.update(changes)
                plan = self.plan(v)
                self.assertEqual(plan["scenario"], expected)
                self.assertFalse(plan["admissionReady"])
                self.assertFalse(plan["productionActivated"])

    def test_hotfix_is_priority_not_admission_bypass(self):
        ordinary = self.plan(request())
        hotfix = request(); hotfix["urgency"] = "hotfix"
        self.assertEqual(self.plan(hotfix)["requiredGates"], ordinary["requiredGates"])
        for path in ("apps/api/migrations/999.sql", "apps/api/src/infrastructure/db/migrator.ts",
                     "apps/deep-agent-service/uv.lock", "pnpm-lock.yaml", "other/schema.json"):
            plan = self.plan(hotfix, [path])
            self.assertEqual(plan["scenario"], "maintenance")
            self.assertFalse(plan["thirtyMinuteEligible"])

    def test_additive_changes_retain_backup_rehearsal_readback(self):
        v = request(); v.update(migrationRisk="additive", artifactState="sealed")
        self.assertIn("migration-backup-rehearsal-readback", self.plan(v)["requiredGates"])

    def test_boolean_strings_and_unknown_fields_rejected(self):
        for change in ({"productionHealthy": "false"}, {"force": True}, {"artifactState": "ready"}, {"schemaVersion": True}):
            v = request(); v.update(change)
            with self.assertRaises((ValueError, TypeError)):
                self.plan(v)

    def test_config_and_seed_cannot_conceal_any_code_diff(self):
        for kind in ("config", "seed"):
            v = request(); v["changeKind"] = kind
            with self.assertRaisesRegex(ValueError, "CANNOT_HIDE"):
                self.plan(v, ["apps/web/page.tsx"])

    def test_no_sql_diff_is_not_no_database_side_effects(self):
        plan = self.plan(request(), ["apps/api/src/server.ts"])
        self.assertEqual(plan["scenario"], "cold")
        self.assertTrue(any("startup cleanup" in n for n in plan["notes"]))
        self.assertIn("preactivate", plan["requiredGates"])


class CliIntegration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Offline fixture")
        self.base = self.commit("apps/web/page.tsx", "white page\n")

    def git(self, *args):
        return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", "-C", str(self.repo), *args], stderr=subprocess.DEVNULL).decode().strip()

    def commit(self, path, content):
        file = self.repo / path; file.parent.mkdir(parents=True, exist_ok=True); file.write_text(content)
        self.git("add", "--", path); self.git("commit", "-qm", "offline fixture")
        return self.git("rev-parse", "HEAD")

    def run_cli(self, value):
        file = self.repo / "request.json"; file.write_text(json.dumps(value))
        r = subprocess.run([sys.executable, "-I", "-B", str(ENTRY), "classify", "--repo", str(self.repo), str(file)], capture_output=True)
        return r.returncode, json.loads(r.stdout)

    def test_actual_git_cli_detects_sql_deletion_even_when_renamed(self):
        sql = self.commit("apps/api/migrations/001.sql", "select 1;\n")
        (self.repo / "apps/api/migrations/001.sql").unlink()
        self.git("add", "-u")
        source = self.commit("notes/former-query.txt", "select 1;\n")
        code, result = self.run_cli(request(sql, source))
        self.assertEqual(code, 0)
        self.assertEqual(result["scenario"], "maintenance")
        self.assertIn("apps/api/migrations/001.sql", result["databaseSensitivePaths"])

    def test_recovery_allows_exact_backward_target_but_normal_release_does_not(self):
        failing = self.commit("apps/web/page.tsx", "faulty\n")
        value = request(failing, self.base)
        self.assertEqual(self.run_cli(value)[0], 1)
        value["productionHealthy"] = False
        code, result = self.run_cli(value)
        self.assertEqual(code, 0)
        self.assertEqual(result["scenario"], "recovery")
        self.assertFalse(result["admissionReady"])

    def test_actual_git_cli_pins_commits_ignores_worktree_and_rejects_branch(self):
        source = self.commit("apps/web/page.tsx", "updated\n")
        (self.repo / "apps/web/page.tsx").write_text("uncommitted\n")
        code, result = self.run_cli(request(self.base, source))
        self.assertEqual(code, 0)
        self.assertEqual(result["sourceSha"], source)
        self.assertEqual(result["scenario"], "cold")
        code, result = self.run_cli(request(self.base, "HEAD"))
        self.assertEqual(code, 1)
        self.assertFalse(result["productionActivated"])

    def test_duplicate_json_key_rejected_at_cli_boundary(self):
        file = self.repo / "duplicate.json"; file.write_text('{"schemaVersion":1,"schemaVersion":1}')
        r = subprocess.run([sys.executable, "-B", str(ENTRY), "classify", str(file)], capture_output=True)
        self.assertEqual(r.returncode, 1)
        self.assertNotIn(b"Traceback", r.stderr)


class Timeline(unittest.TestCase):
    def test_browser_event_cannot_hide_later_failure_or_timezone_less_time(self):
        v = timeline(); extra = dict(v["events"][-1], name="after.acceptance")
        v["events"].append(extra)
        with self.assertRaisesRegex(ValueError, "ACCEPTANCE_MUST_BE_FINAL"): a.timeline(v)
        v = timeline(); v["requestedAt"] = "2026-10-11T00:00:00"
        with self.assertRaisesRegex(ValueError, "TIME_ZONE_REQUIRED"): a.timeline(v)
        v = timeline(); v["schemaVersion"] = True
        with self.assertRaises(ValueError): a.timeline(v)

    def test_measures_both_clocks_without_claiming_cloud_acceptance(self):
        result = a.timeline(timeline())
        self.assertEqual(result["calendarSeconds"], 1200)
        self.assertEqual(result["executionSeconds"], 1140)
        self.assertEqual(result["queueAndApprovalSeconds"], 60)
        self.assertTrue(result["calendarTargetMet"])
        self.assertFalse(result["evidenceContentsVerified"])
        self.assertFalse(result["productionAvailable"])

    def test_over_budget_never_relabelled_as_30_minutes(self):
        result = a.timeline(timeline(minutes=31))
        self.assertFalse(result["calendarTargetMet"])
        self.assertFalse(result["activationTargetMet"])

    def test_partial_cloud_success_is_not_end_to_end(self):
        value = timeline(); value["events"] = value["events"][:3]
        with self.assertRaisesRegex(ValueError, "EVENTS_MISSING"):
            a.timeline(value)

    def test_failure_identity_time_order_and_missing_browser_rejected(self):
        for field, val in (("sourceSha", "e" * 40), ("attemptId", "other"),
                           ("status", "skipped"), ("at", "2026-10-10T00:00:00+00:00"),
                           ("evidenceSha256", "")):
            with self.subTest(field=field):
                v = timeline(); v["events"][-1][field] = val
                with self.assertRaises(ValueError): a.timeline(v)
        v = timeline(); v["events"][-1]["name"] = "healthz"
        with self.assertRaisesRegex(ValueError, "EVENTS_MISSING"): a.timeline(v)


class RegressionRunner(unittest.TestCase):
    def test_zero_tests_and_skipped_tests_never_pass(self):
        commands = {"fixture": [["-c", "print('Ran 0 tests in 0.01s\\nOK')"],
                                ["-c", "print('Ran 1 test in 0.01s\\nOK (skipped=1)')"]]}
        with patch.object(a, "SUITES", commands):
            result = a.run_suite("fixture", 10)
        self.assertEqual([r["status"] for r in result["results"]], ["incomplete", "incomplete"])
        self.assertFalse(result["passed"])

    def test_real_subprocess_failure_keeps_all_groups_and_removes_credentials(self):
        commands = {"fixture": [["-c", "import os;assert 'GH_TOKEN' not in os.environ;assert 'ALIBABA_CLOUD_SECURITY_TOKEN' not in os.environ"],
                                ["-c", "raise SystemExit(2)"], ["-c", "print('safe')"]]}
        with patch.object(a, "SUITES", commands), patch.dict(os.environ, {"GH_TOKEN": "fixture-secret", "ALIBABA_CLOUD_SECURITY_TOKEN": "fixture-secret"}):
            result = a.run_suite("fixture", 10)
        self.assertEqual([r["status"] for r in result["results"]], ["passed", "failed", "passed"])
        self.assertFalse(result["passed"])
        self.assertFalse(result["cloudEndToEndTested"])
        self.assertNotIn("fixture-secret", json.dumps(result))

    def test_real_timeout_is_failed_not_skipped_or_retried(self):
        commands = {"fixture": [["-c", "import time;time.sleep(30)"], ["-c", "raise Exception('must not run')"]]}
        with patch.object(a, "SUITES", commands):
            result = a.run_suite("fixture", 1)
        self.assertEqual([r["status"] for r in result["results"]], ["timeout", "not-run-budget-exhausted"])
        self.assertFalse(result["passed"])


if __name__ == "__main__":
    unittest.main()
